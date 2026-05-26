import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';

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
    const backendUrl = `${backendBase}/api/rbac/${path}`;
    const queryString = request.nextUrl.searchParams.toString();
    const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;

    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    const authHeader = request.headers.get('Authorization');
    if (authHeader) headers['Authorization'] = authHeader;
    const cookie = request.headers.get('cookie');
    if (cookie) headers['cookie'] = cookie;

    const requestOptions: RequestInit = {
      method,
      headers,
      credentials: 'include',
    };

    if (!['GET', 'HEAD'].includes(method)) {
      const body = await request.text();
      if (body) {
        requestOptions.body = body;
        headers['Content-Type'] = contentType || 'application/json';
      }
    }

    const response = await fetch(fullUrl, requestOptions);
    const responseContentType = response.headers.get('content-type') || '';

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    if (responseContentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }

    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { 'Content-Type': responseContentType || 'text/plain' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/rbac] Proxy error:', error);
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
