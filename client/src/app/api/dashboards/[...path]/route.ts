import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/**
 * Catch-all proxy route for /api/dashboards/* endpoints.
 * Forwards requests to the backend FastAPI server at /api/dashboards/...
 */
export async function GET(request: NextRequest, context: { params?: any }) {
  return handleRequest(request, context, 'GET');
}

export async function POST(request: NextRequest, context: { params?: any }) {
  return handleRequest(request, context, 'POST');
}

export async function PUT(request: NextRequest, context: { params?: any }) {
  return handleRequest(request, context, 'PUT');
}

export async function PATCH(request: NextRequest, context: { params?: any }) {
  return handleRequest(request, context, 'PATCH');
}

export async function DELETE(request: NextRequest, context: { params?: any }) {
  return handleRequest(request, context, 'DELETE');
}

async function handleRequest(request: NextRequest, context: { params?: any }, method: string) {
  try {
    const rawParams = context?.params;
    const resolvedParams =
      rawParams && typeof rawParams.then === 'function' ? await rawParams : rawParams;
    const pathSegments = resolvedParams?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');

    const backendBase = getBackendUrlForApi();
    // Backend mounts dashboards router at /api/dashboards (see core/api.py)
    const backendUrl = `${backendBase}/api/dashboards${path ? `/${path}` : ''}`;

    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;

    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    Object.assign(headers, buildProxyAuthHeaders(request));

    const requestOptions: RequestInit = { method, headers };

    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      try {
        const body = await request.text();
        if (body) requestOptions.body = body;
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      } catch {
        // body not available
      }
    }

    const response = await fetch(fullUrl, requestOptions);

    const responseContentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      if (responseContentType.includes('application/json')) {
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
        { status: response.status }
      );
    }

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    // Pipe SSE streams through without buffering (dashboard build progress, etc.)
    if (responseContentType.includes('text/event-stream') && response.body) {
      const { pipeTolerantStream } = await import('@/app/api/lib/streamProxy');
      return new NextResponse(pipeTolerantStream(response.body), {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    if (responseContentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }

    const text = await response.text();
    return NextResponse.json({ data: text }, { status: response.status });
  } catch (error: any) {
    console.error(`[api/dashboards] Proxy error:`, error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to proxy request to backend' },
      { status: 500 }
    );
  }
}
