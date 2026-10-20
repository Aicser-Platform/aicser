import { DEFAULT_LOCALE } from '@/config/locales';
import { isMessageLocale } from '@/config/localeMessages';

/**
 * Load translation JSON at runtime (not via webpack) so Docker/WSL dev mounts
 * do not trip HMR with transient empty reads on large locale files.
 */
export async function loadLocaleMessages(locale: string): Promise<Record<string, unknown>> {
  const code = isMessageLocale(locale) ? locale : DEFAULT_LOCALE;
  const res = await fetch(`/api/locales/${encodeURIComponent(code)}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Failed to load locale "${code}" (${res.status})`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid locale payload for "${code}"`);
  }
  return data;
}
