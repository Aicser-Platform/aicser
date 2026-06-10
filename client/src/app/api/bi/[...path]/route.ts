import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';
import { buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

/** Proxies /api/bi/* → FastAPI /api/bi/* (Power BI / Tableau sync). */
export async function GET(request: NextRequest, context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> }) {
  return proxy(request, context, 'GET');
}

export async function POST(request: NextRequest, context: { params?: Promise<Record<string, unknown>> | Record<string, unknown> }) {
  return proxy(request, context, 'POST');
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
    const backendUrl = `${backendBase}/api/bi/${path}${queryString ? `?${queryString}` : ''}`;

    const headers: Record<string, string> = {};
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    Object.assign(headers, buildProxyAuthHeaders(request));
    const orgHeader = request.headers.get('X-Organization-Id');
    if (orgHeader) headers['X-Organization-Id'] = orgHeader;

    const init: RequestInit = { method, headers, credentials: 'include' };
    if (method !== 'GET' && method !== 'HEAD') {
      const body = await request.arrayBuffer();
      if (body.byteLength) init.body = body;
    }

    const response = await fetch(backendUrl, init);
    const responseContentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      if (responseContentType.includes('application/json')) {
        return NextResponse.json(await response.json(), { status: response.status });
      }
      return NextResponse.json({ error: await response.text() }, { status: response.status });
    }

    if (responseContentType.includes('application/json')) {
      return NextResponse.json(await response.json(), { status: response.status });
    }

    const blob = await response.arrayBuffer();
    const outHeaders = new Headers();
    if (responseContentType) outHeaders.set('content-type', responseContentType);
    const disposition = response.headers.get('content-disposition');
    if (disposition) outHeaders.set('content-disposition', disposition);
    return new NextResponse(blob, { status: response.status, headers: outHeaders });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Proxy failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
