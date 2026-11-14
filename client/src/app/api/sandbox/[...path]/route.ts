/**
 * Proxy for /api/sandbox/* → FastAPI /api/sandbox/*
 *
 * Through Next.js so the session cookie lands on this origin.
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
  const headers = new Headers();
  headers.set('content-type', request.headers.get('content-type') ?? 'application/json');
  const authHeaders = buildProxyAuthHeaders(request);
  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }

  const bodyBuffer =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  const upstream = await fetchBackendUrlWithRetry(
    (backend) => `${backend}/api/sandbox/${upstreamPath}${search}`,
    {
      method: request.method,
      headers,
      body: bodyBuffer,
      // @ts-expect-error — duplex is required for streaming bodies in Node 18+
      duplex: 'half',
      // Starting a workspace creates it, so a slow answer must not be retried into a second one.
      timeoutMs: 30_000,
      retries: request.method === 'GET' ? 3 : 1,
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
