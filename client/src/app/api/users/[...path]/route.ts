import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForApi } from '@/utils/backendUrl';

async function handleRequest(request: NextRequest, context: { params?: any }, method: string) {
  try {
    const rawParams = context?.params;
    const resolved = rawParams && typeof rawParams.then === 'function' ? await rawParams : rawParams;
    const pathSegments = resolved?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');

    const backendBase = getBackendUrlForApi();
    const backendUrl = `${backendBase}/api/users/${path}`;

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

    const requestOptions: RequestInit = { method, headers, credentials: 'include' };

    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const ct = request.headers.get('content-type') || '';
      if (ct.includes('multipart/form-data')) {
        const blob = await request.clone().blob();
        requestOptions.body = blob;
        headers['Content-Type'] = ct;
      } else {
        const body = await request.text().catch(() => '');
        if (body) requestOptions.body = body;
      }
    }

    const response = await fetch(fullUrl, requestOptions);

    const resCt = response.headers.get('content-type') || '';
    if (!response.ok) {
      if (resCt.includes('application/json')) {
        try {
          return NextResponse.json(await response.json(), { status: response.status });
        } catch {}
      }
      const text = await response.text().catch(() => 'Unknown error');
      return NextResponse.json({ error: text }, { status: response.status });
    }

    if (resCt.includes('application/json')) {
      return NextResponse.json(await response.json(), { status: response.status });
    }
    const text = await response.text();
    return new NextResponse(text, { status: response.status });
  } catch (error: any) {
    console.error('[api/users/...] Proxy error:', error);
    return NextResponse.json({ error: error.message || 'Proxy error' }, { status: 500 });
  }
}

export const GET    = (req: NextRequest, ctx: any) => handleRequest(req, ctx, 'GET');
export const POST   = (req: NextRequest, ctx: any) => handleRequest(req, ctx, 'POST');
export const PUT    = (req: NextRequest, ctx: any) => handleRequest(req, ctx, 'PUT');
export const PATCH  = (req: NextRequest, ctx: any) => handleRequest(req, ctx, 'PATCH');
export const DELETE = (req: NextRequest, ctx: any) => handleRequest(req, ctx, 'DELETE');
