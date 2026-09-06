/**
 * Per-browser identity for anonymous embed-chat visitors.
 *
 * The backend's embed-chat auth (server/ee/modules/embed/chat_auth.py) has
 * no concept of "user" for an anonymous visitor — every visitor of one
 * embed widget resolves to the same embed-token-owner identity (the org
 * admin who minted the token from Settings > Embed). Without a separate
 * per-visitor id, the backend would have no way to tell two different
 * anonymous visitors of the SAME widget apart, so conversation isolation
 * (server/ee/modules/embed/chat_conversation.py) and the per-visitor rate
 * limit (chat_rate_limit.py) key off this value instead — sent on every
 * request as the `X-Embed-Visitor-Id` header.
 *
 * Persisted in localStorage so a visitor keeps the same identity (and thus
 * their conversation history) across reloads of the same browser, without
 * ever being derived from anything identifying (no IP, no fingerprint, no
 * account) — it's a random id with no meaning outside this widget.
 */

const STORAGE_KEY = 'aicser_embed_visitor_id';

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to manual fallback below
  }
  // Fallback for browsers/contexts without crypto.randomUUID (non-secure
  // context, very old browser) — not cryptographically strong, but this id
  // only needs to be unique-enough per browser, not unguessable.
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Returns a stable per-browser visitor id, creating and persisting one on
 * first call. Safe to call in environments where localStorage is
 * unavailable or throws (private browsing, disabled storage) — falls back
 * to an in-memory id for the lifetime of the page in that case.
 */
export function getOrCreateEmbedVisitorId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.trim()) return existing.trim();
    const created = randomId();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return randomId();
  }
}
