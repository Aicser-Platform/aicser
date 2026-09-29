/**
 * The session an embed page is running on (see useEmbedSession). A page opens one session from
 * its link token; when the host app hands over a fresh token before the session runs out, the
 * new session replaces it here, and every data request picks it up without reloading the view.
 */

let latestSessionToken: string | null = null;

export function setLatestEmbedToken(token: string | null): void {
  latestSessionToken = token;
}

/** The token to send with an embed data request: the newest session once one is open. */
export function resolveEmbedToken(token: string): string;
export function resolveEmbedToken(token: string | undefined): string | undefined;
export function resolveEmbedToken(token: string | undefined): string | undefined {
  return token && latestSessionToken ? latestSessionToken : token;
}

function hostOf(value: string): string {
  const raw = (value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
  } catch {
    return raw.split('/')[0].split(':')[0];
  }
}

/** Same rule as the server's origin_allowed: the site or any subdomain of it. */
export function originAllowed(origin: string, allowed: string[]): boolean {
  const host = hostOf(origin);
  if (!host) return false;
  return allowed.some((d) => {
    const h = hostOf(d);
    return Boolean(h) && (host === h || host.endsWith(`.${h}`));
  });
}

/** The site showing this page in its iframe, as the browser reports it ('' when not framed). */
export function embeddingOrigin(): string {
  if (typeof window === 'undefined' || window.parent === window) return '';
  try {
    const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    if (ancestors && ancestors.length > 0) return ancestors[0];
  } catch {
    /* not available in this browser */
  }
  try {
    return document.referrer ? new URL(document.referrer).origin : '';
  } catch {
    return '';
  }
}
