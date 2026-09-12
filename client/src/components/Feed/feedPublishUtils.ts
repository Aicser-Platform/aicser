import { formatApiValidationError } from '@/utils/validationErrorMessage';

/** User-friendly message for feed publish failures — avoids raw validation dumps. */
export function formatFeedPublishError(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : '';
  // Next.js proxy surfaces backend downtime as TypeError: fetch failed /
  // ECONNREFUSED while aiser-server is restarting.
  if (
    /fetch failed|econnrefused|networkerror|failed to fetch|socket hang up/i.test(raw) ||
    /fetch failed|econnrefused|failed to fetch/i.test(String((error as { cause?: unknown })?.cause ?? ''))
  ) {
    return 'The server is temporarily unreachable. Wait a moment and try Share to Feed again.';
  }
  const formatted = formatApiValidationError(error);
  if (!formatted || formatted === 'Request failed') return fallback;
  if (formatted.length > 180) return fallback;
  return formatted;
}
