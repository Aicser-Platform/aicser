import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

type RouteContext = { params?: Promise<Record<string, unknown>> | Record<string, unknown> };

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context, 'GET');
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context, 'POST');
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context, 'PUT');
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context, 'PATCH');
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context, 'DELETE');
}

async function proxy(request: NextRequest, context: RouteContext, method: string) {
  try {
    const rawParams = context?.params;
    const resolvedParams =
      rawParams && typeof (rawParams as Promise<unknown>).then === 'function'
        ? await rawParams
        : rawParams;
    const pathSegments = (resolvedParams as { path?: string[] })?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');

    const backendBase = getBackendUrlForProxy();
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const backendUrl = `${backendBase}/api/rbac/${path}${queryString ? `?${queryString}` : ''}`;

    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    Object.assign(headers, buildProxyAuthHeaders(request));
    const orgHeader = request.headers.get('X-Organization-Id');
    if (orgHeader) headers['X-Organization-Id'] = orgHeader;

    const init: RequestInit = { method, headers, credentials: 'include' };
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const body = await request.text();
      if (body) init.body = body;
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(backendUrl, init);

    if (response.status === 204) return new NextResponse(null, { status: 204 });

    if (!response.ok) {
      const text = await response.text();
      try {
        return NextResponse.json(JSON.parse(text), { status: response.status });
      } catch {
        return NextResponse.json({ error: text }, { status: response.status });
      }
    }

    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return NextResponse.json(await response.json(), { status: response.status });
    }
    return NextResponse.json({ data: await response.text() }, { status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Proxy failed';
    console.error('[api/rbac] Proxy error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
