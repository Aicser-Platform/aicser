import type { NextRequest } from 'next/server';

const AUTH_COOKIE = 'auth_token';

export function parseAuthTokenFromCookieHeader(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq);
    if (name !== AUTH_COOKIE) continue;
    const value = trimmed.slice(eq + 1).trim();
    if (!value || value === 'null') return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/**
 * Build upstream auth headers from raw cookie / Authorization values (Pages API).
 */
export function buildProxyAuthHeadersFromRaw(
  cookieHeader: string | null | undefined,
  authorizationHeader?: string | null,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (cookieHeader) headers['Cookie'] = cookieHeader;

  const existingAuth = authorizationHeader?.trim();
  if (existingAuth) {
    headers['Authorization'] = existingAuth;
    return headers;
  }

  const token = parseAuthTokenFromCookieHeader(cookieHeader);
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * BFF proxy auth: forward browser cookies and promote auth_token → Authorization
 * so FastAPI JWTCookieBearer receives the session on server-side upstream calls.
 */
export function buildProxyAuthHeaders(
  request: NextRequest,
  extra: Record<string, string> = {},
): Record<string, string> {
  return buildProxyAuthHeadersFromRaw(
    request.headers.get('cookie'),
    request.headers.get('authorization') ?? request.headers.get('Authorization'),
    extra,
  );
}

/** Copy Set-Cookie from upstream fetch (Node 18+ getSetCookie when available). */
export function appendUpstreamSetCookies(upstream: Response, target: Headers): void {
  const headers = upstream.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    for (const cookie of headers.getSetCookie()) {
      target.append('set-cookie', cookie);
    }
    return;
  }
  const raw = upstream.headers.get('set-cookie');
  if (raw) target.append('set-cookie', raw);
}
