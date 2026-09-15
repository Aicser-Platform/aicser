import { NextResponse } from 'next/server';

/**
 * Deploy healthcheck target (e.g. Railway's railway.toml healthcheckPath).
 * Deliberately static/unauthenticated — `/` always 307s to /login without an
 * auth_token cookie (see src/proxy.ts), which infra healthcheck probes never
 * carry, so pointing a healthcheck at `/` fails every attempt. `/api/*` paths
 * skip the proxy's auth guard entirely, so this always returns a plain 200.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
