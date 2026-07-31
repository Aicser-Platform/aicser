const FALLBACK_AISER_VERSION = '1.1.1';

export function normalizeAiserVersion(version?: string | null): string {
  const raw = (version || '').trim();
  if (!raw || raw === 'latest') return FALLBACK_AISER_VERSION;
  return raw.replace(/^ee-v/i, '').replace(/^aicser-v/i, '');
}

export function formatAiserVersion(version?: string | null): string {
  const normalized = normalizeAiserVersion(version);
  return /^[0-9]/.test(normalized) ? `v${normalized}` : normalized;
}

export function getBuildTimeAiserVersionLabel(): string {
  return formatAiserVersion(process.env.NEXT_PUBLIC_AISER_VERSION || FALLBACK_AISER_VERSION);
}
