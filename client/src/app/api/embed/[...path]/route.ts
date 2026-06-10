import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/** Proxies /api/embed/* → FastAPI /api/embed/* */
export async function GET(request: NextRequest, context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> }) {
  return proxy(request, context, 'GET');
}

export async function POST(request: NextRequest, context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> }) {
  return proxy(request, context, 'POST');
}

export async function PUT(request: NextRequest, context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> }) {
  return proxy(request, context, 'PUT');
}

export async function PATCH(request: NextRequest, context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> }) {
  return proxy(request, context, 'PATCH');
}

export async function DELETE(request: NextRequest, context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> }) {
  return proxy(request, context, 'DELETE');
}

async function proxy(
  request: NextRequest,
  context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> },
  method: string
) {
  try {
    const rawParams = context?.params;
    const resolvedParams = rawParams && typeof (rawParams as Promise<unknown>).then === 'function' ? await rawParams : rawParams;
    const pathSegments = (resolvedParams as { path?: string[] })?.path || [];
    const path = Array.isArray(pathSegments) ? pathSegments.join('/') : String(pathSegments || '');

    const backendBase = getBackendUrlForProxy();
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const backendUrl = `${backendBase}/api/embed/${path}${queryString ? `?${queryString}` : ''}`;

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
    if (!response.ok) {
      const text = await response.text();
      try {
        return NextResponse.json(JSON.parse(text), { status: response.status });
      } catch {
        return NextResponse.json({ error: text }, { status: response.status });
      }
    }
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Proxy failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
