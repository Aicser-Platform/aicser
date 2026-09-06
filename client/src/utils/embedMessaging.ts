export type EmbedMessageType = 'ready' | 'resize' | 'navigate' | 'error' | 'ping';

export interface EmbedMessage<T = unknown> {
  source: 'aicser-embed';
  type: EmbedMessageType;
  payload?: T;
}

export interface EmbedResizePayload {
  height: number;
  width?: number;
}

export interface EmbedNavigatePayload {
  path: string;
}

export interface EmbedErrorPayload {
  message: string;
  code?: string;
}

const MESSAGE_SOURCE = 'aicser-embed';

export function isEmbedMessage(data: unknown): data is EmbedMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as EmbedMessage).source === MESSAGE_SOURCE &&
    typeof (data as EmbedMessage).type === 'string'
  );
}

/** Send a postMessage to the parent frame (no-op when not embedded). */
export function postEmbedMessage<T>(
  type: EmbedMessageType,
  payload?: T,
  targetOrigin: string = '*'
): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  const message: EmbedMessage<T> = { source: MESSAGE_SOURCE, type, payload };
  window.parent.postMessage(message, targetOrigin);
}

/** Notify parent that the embed finished loading. */
export function notifyEmbedReady(extra?: Record<string, unknown>): void {
  postEmbedMessage('ready', extra);
}

/** Ask parent to resize the iframe container. */
export function notifyEmbedResize(height: number, width?: number): void {
  postEmbedMessage<EmbedResizePayload>('resize', { height, width });
}

/** Report an error to the parent page. */
export function notifyEmbedError(message: string, code?: string): void {
  postEmbedMessage<EmbedErrorPayload>('error', { message, code });
}

/**
 * Extract a human-readable message from a backend error response body.
 *
 * Embed pages are public/unauthenticated and deliberately don't go through
 * fetchApi (which attaches session auth), so each one hand-rolled its own
 * `res.json()` error parsing - every one of them only checked `detail.detail`
 * (FastAPI's raw default HTTPException shape). This backend actually
 * standardized on `{error, message, details}` (see server/src/shared/
 * api_errors.py's error_body/http_exception_to_response - RFC-7807-inspired,
 * used by the app's own global exception handler), and `.detail` only shows
 * up as a plain string on the small minority of routes still raising a bare
 * `HTTPException(detail="...")` directly. Checking only `.detail` meant
 * every route already on the standardized shape (including a security-policy
 * refusal like "this chart's data source has column security enabled")
 * silently fell back to a generic "Failed to load X (500)" with the real,
 * often actionable reason completely discarded - indistinguishable from an
 * actual server bug. Mirrors fetchApi's parsing (client/src/utils/api.ts).
 */
export function parseEmbedErrorDetail(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const b = body as Record<string, unknown>;
  if (typeof b.detail === 'string' && b.detail.trim()) return b.detail;
  if (b.detail && typeof b.detail === 'object') {
    const d = b.detail as Record<string, unknown>;
    if (typeof d.message === 'string' && d.message.trim()) return d.message;
    if (typeof d.error === 'string' && d.error.trim()) return d.error;
  }
  if (typeof b.message === 'string' && b.message.trim()) return b.message;
  if (typeof b.error === 'string' && b.error.trim()) return b.error;
  return fallback;
}

/** Subscribe to embed messages from child iframes (parent-side helper). */
export function listenForEmbedMessages(
  handler: (message: EmbedMessage, event: MessageEvent) => void,
  allowedOrigin?: string
): () => void {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: MessageEvent) => {
    if (allowedOrigin && event.origin !== allowedOrigin) return;
    if (!isEmbedMessage(event.data)) return;
    handler(event.data, event);
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
