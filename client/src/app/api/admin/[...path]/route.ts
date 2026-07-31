import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';
import { fetchBackendWithRetry } from '@/utils/backendFetch';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

async function handleRequest(request: NextRequest, context: { params?: any }, method: string) {
  try {
    const rawParams = context?.params;
    const resolved = rawParams && typeof rawParams.then === 'function' ? await rawParams : rawParams;
    const pathSegments = resolved?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');

    const backendBase = getBackendUrlForApi();
    const backendUrl = `${backendBase}/api/admin/${path}`;
    const queryString = new URL(request.url).searchParams.toString();
    const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;

    const headers: Record<string, string> = buildProxyAuthHeaders(request);
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;

    const requestOptions: RequestInit = { method, headers, credentials: 'include' };
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const body = await request.text().catch(() => '');
      if (body) requestOptions.body = body;
    }

    const response = await fetchBackendWithRetry(fullUrl, {
      ...requestOptions,
      timeoutMs: 15_000,
      retries: 2,
    });

    const resCt = response.headers.get('content-type') || '';
    if (resCt.includes('application/json')) {
      return NextResponse.json(await response.json(), { status: response.status });
    }
    const text = await response.text();
    return new NextResponse(text, { status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Proxy error';
    console.error('[api/admin/...] Proxy error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = (req: NextRequest, ctx: any) => handleRequest(req, ctx, 'GET');
export const POST = (req: NextRequest, ctx: any) => handleRequest(req, ctx, 'POST');
export const PUT = (req: NextRequest, ctx: any) => handleRequest(req, ctx, 'PUT');
export const PATCH = (req: NextRequest, ctx: any) => handleRequest(req, ctx, 'PATCH');
export const DELETE = (req: NextRequest, ctx: any) => handleRequest(req, ctx, 'DELETE');
