import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

export async function handleDashboardProxyRequest(
  request: NextRequest,
  context: { params?: any },
  method: string,
) {
  try {
    const rawParams = context?.params;
    const resolvedParams =
      rawParams && typeof rawParams.then === 'function' ? await rawParams : rawParams;
    const pathSegments = resolvedParams?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');

    const backendBase = getBackendUrlForApi();
    const backendUrl = path
      ? `${backendBase}/api/dashboards/${path}`
      : `${backendBase}/api/dashboards/`;

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
        { status: response.status },
      );
    }

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

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
      { status: 500 },
    );
  }
}
