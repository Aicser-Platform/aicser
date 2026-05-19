import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';

/**
 * Catch-all proxy route for /api/charts/* endpoints.
 * Forwards requests to the backend FastAPI server at /charts/...
 * (visual_charts_router is mounted at /charts with no /api prefix)
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
    // Backend mounts visual_charts_router at /charts (no /api prefix, see core/api.py)
    const backendUrl = `${backendBase}/charts${path ? `/${path}` : ''}`;

    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;

    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;

    const authHeader = request.headers.get('Authorization');
    if (authHeader) headers['Authorization'] = authHeader;

    const cookie = request.headers.get('Cookie');
    if (cookie) headers['Cookie'] = cookie;

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

    if (responseContentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }

    const text = await response.text();
    return NextResponse.json({ data: text }, { status: response.status });
  } catch (error: any) {
    console.error(`[api/charts] Proxy error:`, error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to proxy request to backend' },
      { status: 500 }
    );
  }
}
