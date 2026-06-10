import { ApiError } from '@/utils/api';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value?: string | null): boolean {
  return Boolean(value && UUID_RE.test(String(value).trim()));
}

type ValidationDetail = { loc?: (string | number)[]; msg?: string; type?: string };

function formatDetailEntry(entry: ValidationDetail): string {
  const loc = Array.isArray(entry.loc)
    ? entry.loc.filter((part) => part !== 'body' && part !== 'query').join('.')
    : '';
  const msg = entry.msg || 'Invalid value';
  return loc ? `${loc}: ${msg}` : msg;
}

/** Turn FastAPI 422 / structured API errors into user-facing text. */
export function formatApiValidationError(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.detail;

    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const body = detail as {
        error?: string;
        message?: string;
        details?: ValidationDetail[];
      };
      if (body.error === 'validation_error' && Array.isArray(body.details) && body.details.length) {
        return body.details.map(formatDetailEntry).join('; ');
      }
      if (typeof body.message === 'string' && body.message.trim()) {
        return body.message;
      }
    }

    if (Array.isArray(detail) && detail.length) {
      return detail.map((entry) => formatDetailEntry(entry as ValidationDetail)).join('; ');
    }

    if (typeof detail === 'string' && detail.trim() && detail !== 'validation_error') {
      return detail;
    }

    if (error.message && error.message !== 'validation_error') {
      return error.message;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Request failed';
}
