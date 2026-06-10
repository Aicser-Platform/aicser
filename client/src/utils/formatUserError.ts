/**
 * Map API / network errors to user-friendly messages (avoid raw SQL or stack traces in UI).
 */

export type UserErrorTranslator = (key: string) => string | undefined;

const SQL_MARKERS = /\b(select|insert|update|delete|from|syntax error|relation|column)\b/i;
const API_ERROR_PREFIX = /^API Error:\s*/i;

export function formatUserError(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
  translate?: UserErrorTranslator,
): string {
  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null
          ? (() => {
              const o = error as Record<string, unknown>;
              if (typeof o.message === 'string' && o.message) return o.message;
              if (typeof o.detail === 'string') return o.detail;
              if (typeof o.detail === 'object' && o.detail !== null) {
                const d = o.detail as Record<string, unknown>;
                if (typeof d.message === 'string') return d.message;
              }
              if ('message' in o) return String(o.message);
              return '';
            })()
          : '';

  const message = raw.replace(API_ERROR_PREFIX, '').trim();
  if (!message) return fallback;

  const tr = (key: string, defaultText: string) => translate?.(key) ?? defaultText;

  if (SQL_MARKERS.test(message) && message.length > 80) {
    return tr('sql_query_failed', 'We could not run that query. Check your data connection or simplify the question.');
  }

  if (/401|unauthorized|not authenticated/i.test(message)) {
    return tr('session_expired', 'Your session expired. Please sign in again.');
  }

  if (/403|forbidden|permission/i.test(message)) {
    return tr('permission_denied', 'You do not have permission to do that.');
  }

  if (/404|not found/i.test(message)) {
    return tr('not_found', 'That item could not be found. It may have been removed.');
  }

  if (/429|rate limit|too many requests/i.test(message)) {
    return tr('rate_limited', 'Too many requests. Please wait a moment and try again.');
  }

  if (/network|fetch failed|failed to fetch|ECONNREFUSED/i.test(message)) {
    return tr('network_error', 'Could not reach the server. Check your connection and try again.');
  }

  if (/502|503|504|bad gateway|service unavailable|gateway timeout/i.test(message)) {
    return tr('service_unavailable', 'The service is temporarily unavailable. Please try again shortly.');
  }

  if (message.length > 200) {
    return fallback;
  }

  return message;
}
