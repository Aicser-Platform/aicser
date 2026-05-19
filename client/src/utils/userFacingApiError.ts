import { ApiError } from '@/utils/api';

type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

/** Heuristic: block strings that look like SQL, stacks, or internal traces from user copy. */
function looksInternal(msg: string): boolean {
  const s = msg.slice(0, 500);
  if (s.length > 280) return true;
  return /traceback|File "|at \w+\.|SELECT |INSERT |UPDATE |DELETE FROM|asyncpg|sqlalchemy|Internal Server|ECONNREFUSED|Connection refused/i.test(
    s
  );
}

function detailMessage(detail: unknown): string {
  if (typeof detail === 'string') {
    return looksInternal(detail) ? '' : detail.trim();
  }
  if (detail && typeof detail === 'object') {
    const o = detail as Record<string, unknown>;
    const msg = o.message ?? o.reason ?? o.error;
    if (typeof msg === 'string' && !looksInternal(msg)) {
      return msg.trim().slice(0, 240);
    }
    if (o.code === 'policy_denied' && typeof o.reason === 'string') {
      const r = o.reason.trim();
      return r.startsWith('policy_denied:') ? r.slice('policy_denied:'.length).trim() : r;
    }
  }
  return '';
}

/**
 * Safe, user-facing error text for dashboard surfaces (e.g. Data Platform).
 * Never surfaces raw 5xx bodies, SQL, or stack traces.
 */
export function formatUserFacingApiError(err: unknown, labelMsg: string, t: Translate): string {
  if (err instanceof ApiError) {
    const st = err.status;
    const dm = detailMessage(err.detail);

    if (st === 404) {
      return t('api_err_not_found', { label: labelMsg });
    }
    if (st === 402) {
      return t('api_err_plan', {
        label: labelMsg,
        detail: dm || t('api_err_plan_default'),
      });
    }
    if (st === 403) {
      return dm ? t('api_err_forbidden', { label: labelMsg, detail: dm }) : t('api_err_forbidden_default');
    }
    if (st === 401) {
      return t('api_err_unauthorized', { label: labelMsg });
    }
    if (st === 400 || st === 422) {
      if (dm) {
        return t('api_err_message', { label: labelMsg, detail: dm });
      }
      return t('api_err_validation_generic', { label: labelMsg });
    }
    if (st >= 500) {
      return t('api_err_server_generic', { label: labelMsg });
    }
    if (dm) {
      return t('api_err_message', { label: labelMsg, detail: dm });
    }
    return t('api_err_server_generic', { label: labelMsg });
  }
  if (err instanceof Error && err.message && !looksInternal(err.message)) {
    return t('api_err_message', { label: labelMsg, detail: err.message.slice(0, 200) });
  }
  return t('api_err_unknown', { label: labelMsg });
}
