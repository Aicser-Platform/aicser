/**
 * Proxy for /api/auth/* → FastAPI /auth/*
 *
 * Forwarding the request through Next.js ensures the browser's auth_token
 * cookie is scoped to the Next.js origin (port 3000), which the middleware
 * can then read for route protection.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchBackendUrlWithRetry } from '@/utils/backendFetch';
import { appendUpstreamSetCookies, buildProxyAuthHeaders } from '@/utils/proxyAuthHeaders';

async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const upstreamPath = path.join('/');
  const search = request.nextUrl.search;
  const isAuthMutation = upstreamPath === 'login' || upstreamPath === 'register';

  const headers = new Headers();
  headers.set('content-type', request.headers.get('content-type') ?? 'application/json');
  const authHeaders = buildProxyAuthHeaders(request);
  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }

  const bodyBuffer =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  const upstream = await fetchBackendUrlWithRetry(
    (backend) => `${backend}/auth/${upstreamPath}${search}`,
    {
      method: request.method,
      headers,
      body: bodyBuffer,
      // @ts-expect-error — duplex is required for streaming bodies in Node 18+
      duplex: 'half',
      timeoutMs: isAuthMutation ? 8_000 : 12_000,
      retries: isAuthMutation ? 1 : 3,
    },
  );

  if (!upstream) {
    return new NextResponse(
      JSON.stringify({
        detail: 'Backend unreachable',
        message: 'The server is starting or temporarily unavailable. Wait a moment and try again.',
      }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  const responseHeaders = new Headers();
  appendUpstreamSetCookies(upstream, responseHeaders);
  const contentType = upstream.headers.get('content-type');
  if (contentType) responseHeaders.set('content-type', contentType);

  const responseBody = await upstream.text();
  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
