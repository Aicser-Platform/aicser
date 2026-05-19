/**
 * Proxy for /api/auth/* → FastAPI /auth/*
 *
 * Forwarding the request through Next.js ensures the browser's auth_token
 * cookie is scoped to the Next.js origin (port 3000), which the middleware
 * can then read for route protection.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrlForProxy } from '@/utils/backendUrl';

const FALLBACK_BACKENDS = ['http://localhost:8000', 'http://chat2chart-server:8000'];

async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const primaryBackend = getBackendUrlForProxy();
  const upstreamPath = path.join('/');
  const search = request.nextUrl.search;

  const headers = new Headers();
  headers.set('content-type', request.headers.get('content-type') ?? 'application/json');
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);

  // Read body once (streaming body can only be consumed once)
  const bodyBuffer = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : await request.arrayBuffer();

  const candidates = [primaryBackend, ...FALLBACK_BACKENDS.filter(b => b !== primaryBackend)];

  let upstream: Response | null = null;
  for (const backend of candidates) {
    const url = `${backend}/auth/${upstreamPath}${search}`;
    try {
      upstream = await fetch(url, {
        method: request.method,
        headers,
        body: bodyBuffer,
        // @ts-expect-error — duplex is required for streaming bodies in Node 18+
        duplex: 'half',
      });
      break;
    } catch {
      // try next candidate
    }
  }

  if (!upstream) {
    return new NextResponse(JSON.stringify({ detail: 'Backend unreachable' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') {
      responseHeaders.append('set-cookie', value);
    } else if (key.toLowerCase() === 'content-type') {
      responseHeaders.set('content-type', value);
    }
  }

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
