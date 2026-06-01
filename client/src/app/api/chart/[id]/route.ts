
import { getBackendUrl } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';
import { NextRequest, NextResponse } from 'next/server';

const backendBase = getBackendUrl();
const backendUrl = `${backendBase}/api/chart`;

async function forwardRequest(method: string, id: string, request?: NextRequest) {
  try {
    const targetUrl = `${backendUrl}/${id}`;

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(request ? buildProxyAuthHeaders(request) : {}),
      },
    };

    if (request && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      const body = await request.json();
      options.body = JSON.stringify(body);
    }

    console.log(`[API Proxy ID] ${method} ${targetUrl}`);
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
      console.error(`[API Proxy ID] Backend error: ${response.status} - ${errorText}`);
      return NextResponse.json(
        { success: false, error: errorText || `Backend error: ${response.status}` },
        { status: response.status },
      );
    }

    if (response.status === 204) {
      return NextResponse.json({ success: true });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(`[API Proxy ID] Exception:`, error);
    return NextResponse.json({ success: false, error: 'Backend connection failed' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return forwardRequest('GET', params.id, request);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return forwardRequest('POST', params.id, request);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return forwardRequest('PUT', params.id, request);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return forwardRequest('DELETE', params.id, request);
}
