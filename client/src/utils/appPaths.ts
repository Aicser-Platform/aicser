const isEE = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

/** Default landing route after login (edition-aware). */
export function getDefaultAppPath(): string {
  return isEE ? '/chat' : '/dashboards';
}

export function isEnterpriseEdition(): boolean {
  return isEE;
}

/** Edition-aware chat URL — CE builds land on dashboards instead of /chat. */
export function getChatHref(params?: Record<string, string | undefined | null>): string {
  if (!isEE) return getDefaultAppPath();
  const entries = Object.entries(params || {}).filter(
    ([, v]) => v != null && String(v).trim() !== '',
  ) as [string, string][];
  if (!entries.length) return '/chat';
  return `/chat?${new URLSearchParams(entries).toString()}`;
}
