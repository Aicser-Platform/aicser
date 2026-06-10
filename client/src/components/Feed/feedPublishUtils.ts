import { formatApiValidationError } from '@/utils/validationErrorMessage';

/** User-friendly message for feed publish failures — avoids raw validation dumps. */
export function formatFeedPublishError(error: unknown, fallback: string): string {
  const formatted = formatApiValidationError(error);
  if (!formatted || formatted === 'Request failed') return fallback;
  if (formatted.length > 180) return fallback;
  return formatted;
}
