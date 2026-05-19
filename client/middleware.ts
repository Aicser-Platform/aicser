import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that don't require authentication
const PUBLIC_PATHS = ['/login', '/logout', '/api/auth/']

// Static asset prefixes — always allowed
const STATIC_PREFIXES = ['/_next/', '/public/', '/icons/', '/images/', '/favicon', '/sw.js']

function isPublic(pathname: string): boolean {
  if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) return true
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return true
  return false
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const origin = request.headers.get('origin') ?? '*'

  // CORS pre-flight for API routes
  if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    return new NextResponse(null, {
      status: 200,
      headers: { ...corsHeaders(origin), 'Access-Control-Max-Age': '86400' },
    })
  }

  // Add CORS headers to all API responses
  if (pathname.startsWith('/api/')) {
    const response = NextResponse.next()
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => response.headers.set(k, v))
    return response
  }

  // Allow public paths without auth check
  if (isPublic(pathname)) return NextResponse.next()

  // Auth guard: require auth_token cookie
  const token = request.cookies.get('auth_token')
  if (!token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Match everything except Next.js internals and static files
    '/((?!_next/static/|_next/image/|favicon\\.ico).*)',
  ],
}

