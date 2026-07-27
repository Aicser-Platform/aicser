import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';
import { NextRequest, NextResponse } from 'next/server';

const backendBase = getBackendUrlForApi();
const backendUrl = `${backendBase}/api/chart`;

/**
 * Forward /api/chart/:path* → backend /api/chart/:path* including query string.
 * Covers /collections, /:id, /:id/touch, /:id/favorite, /:id/data, etc.
 */
async function forwardRequest(method: string, pathParts: string[], request?: NextRequest) {
  try {
    const suffix = pathParts.filter(Boolean).map(encodeURIComponent).join('/');
    const { searchParams } = request ? new URL(request.url) : { searchParams: new URLSearchParams() };
    const query = searchParams.toString();
    const targetUrl = `${backendUrl}/${suffix}${query ? `?${query}` : ''}`;

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(request ? buildProxyAuthHeaders(request) : {}),
      },
    };

    if (request && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
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
      console.error(`[API Proxy Chart Path] Backend error: ${response.status} - ${errorText}`);
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
    console.error(`[API Proxy Chart Path] Exception:`, error);
    return NextResponse.json({ success: false, error: 'Backend connection failed' }, { status: 500 });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

async function resolvePath(ctx: Ctx): Promise<string[]> {
  const resolved = await ctx.params;
  return resolved.path || [];
}

export async function GET(request: NextRequest, ctx: Ctx) {
  return forwardRequest('GET', await resolvePath(ctx), request);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  return forwardRequest('POST', await resolvePath(ctx), request);
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  return forwardRequest('PUT', await resolvePath(ctx), request);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  return forwardRequest('DELETE', await resolvePath(ctx), request);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  return forwardRequest('PATCH', await resolvePath(ctx), request);
}
