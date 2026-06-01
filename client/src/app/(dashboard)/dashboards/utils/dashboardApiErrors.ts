import { ApiError } from '@/utils/api';

const PUBLISH_OWNER_PATTERNS = [
  'only the publishing owner can edit',
  'publish owner not recorded',
];

export function getDashboardApiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err.message : fallback;
  }
  if (err.status === 403) {
    const detail = typeof err.detail === 'string' ? err.detail : err.message;
    if (PUBLISH_OWNER_PATTERNS.some((p) => detail.toLowerCase().includes(p))) {
      return detail;
    }
  }
  if (typeof err.detail === 'string') return err.detail;
  if (typeof err.detail === 'object' && err.detail?.message) return String(err.detail.message);
  return err.message || fallback;
}

export function isPublishOwnerError(err: unknown): boolean {
  const msg = getDashboardApiErrorMessage(err, '').toLowerCase();
  return PUBLISH_OWNER_PATTERNS.some((p) => msg.includes(p));
}
