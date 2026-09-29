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
  '/health',
  '/offline',
  '/invite/accept',
  '/invite/set-password',
  // Collaboration sockets authenticate themselves (token in the handshake).
  '/socket.io',
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
 * Sites allowed to frame an embed page, from its link token's allowed_domains claim. The claim
 * is read without checking the signature: a forged token can only loosen the header for a page
 * whose data requests it can't authorize anyway (the server verifies every token).
 */
function embedFrameAncestors(token: string | null): string[] {
  if (!token) return [];
  const part = token.split('.')[1];
  if (!part) return [];
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4));
    const domains = (JSON.parse(json) as { allowed_domains?: unknown }).allowed_domains;
    if (!Array.isArray(domains)) return [];
    const hosts = new Set<string>();
    for (const d of domains) {
      const raw = String(d || '').trim().toLowerCase();
      if (!raw) continue;
      let host = '';
      try {
        host = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
      } catch {
        continue;
      }
      if (/^[a-z0-9.-]+$/.test(host)) hosts.add(host);
    }
    return Array.from(hosts).flatMap((h) =>
      h === 'localhost' || h === '127.0.0.1' ? [`http://${h}:*`, `https://${h}:*`] : [`https://${h}`, `https://*.${h}`],
    );
  } catch {
    return [];
  }
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

  if (pathname.startsWith('/embed/')) {
    // Only the sites an embed was made for may show it: browsers refuse to render the page
    // inside any other site's iframe (Power BI, Tableau and Metabase restrict embeds this way).
    const ancestors = embedFrameAncestors(request.nextUrl.searchParams.get('token'));
    const response = NextResponse.next();
    if (ancestors.length) {
      response.headers.set('Content-Security-Policy', `frame-ancestors 'self' ${ancestors.join(' ')}`);
    }
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
