import { getBackendUrl } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';
import { NextRequest, NextResponse } from 'next/server';

const backendBase = getBackendUrl();
const backendUrl = `${backendBase}/api/chart`;

async function forwardRequest(method: string, request?: NextRequest) {
  try {
    const { searchParams } = request ? new URL(request.url) : { searchParams: new URLSearchParams() };
    const query = searchParams.toString();
    const targetUrl = query ? `${backendUrl}?${query}` : backendUrl;

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(request ? buildProxyAuthHeaders(request) : {}),
      },
    };

    if (request && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      // Forward the raw body verbatim (matches the /api/dashboards proxy). Avoid
      // json()/re-stringify so we never alter or drop the request body.
      const rawText = await request.text();
      if (rawText) options.body = rawText;
    }

    const response = await fetch(targetUrl, options);

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          const errorJson = await response.json();
          return NextResponse.json(errorJson, { status: response.status });
        } catch {
          // fall through
        }
      }
      const errorText = await response.text().catch(() => 'Unknown error');
      return NextResponse.json(
        { success: false, error: errorText || `Backend error: ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(`[API Proxy] Exception:`, error);
    return NextResponse.json({ success: false, error: 'Backend connection failed' }, { status: 500 });
  }
}

/**
 * GET
 */
export async function GET(request: NextRequest) {
  return forwardRequest('GET', request);
}

/**
 * POST
 */
export async function POST(request: NextRequest) {
  return forwardRequest('POST', request);
}

/**
 * PUT
 */
export async function PUT(request: NextRequest) {
  return forwardRequest('PUT', request);
}

/**
 * DELETE
 */
export async function DELETE(request: NextRequest) {
  return forwardRequest('DELETE', request);
}
