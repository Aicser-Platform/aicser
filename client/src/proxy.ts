import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Routes that don't require authentication. */
const PUBLIC_PATHS = [
  '/login',
  '/logout',
  '/reset-password',
  '/api/auth/',
  '/discover',
  '/embed/',
  '/embedded/',
  '/offline',
  '/invite/accept',
  '/invite/set-password',
];

/** Static asset prefixes — always allowed. */
const STATIC_PREFIXES = ['/_next/', '/public/', '/icons/', '/images/', '/favicon', '/sw.js'];

/** Root public files (e.g. `/aiser-logo.png`) must not be auth-gated — Next/Image fetches them. */
const STATIC_FILE_RE =
  /\.(?:avif|png|jpe?g|gif|webp|svg|ico|js|mjs|css|woff2?|ttf|eot|mp4|webm|map|txt|json|webmanifest)$/i;

function isPublic(pathname: string): boolean {
  if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (STATIC_FILE_RE.test(pathname)) return true;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return true;
  return false;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * Next.js 16 proxy (formerly middleware).
 * Handles API CORS + auth cookie guard. Keep a single file under src/proxy.ts.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const origin = request.headers.get('origin') ?? '*';

  if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    return new NextResponse(null, {
      status: 200,
      headers: { ...corsHeaders(origin), 'Access-Control-Max-Age': '86400' },
    });
  }

  if (pathname.startsWith('/api/')) {
    const response = NextResponse.next();
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }

  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get('auth_token');
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static/|_next/image/|favicon\\.ico).*)'],
};
