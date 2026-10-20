import { LOCALE_OPTIONS } from '@/config/locales';

/** Locale codes that have a `src/messages/{code}.json` file. */
export const MESSAGE_LOCALE_CODES = new Set(LOCALE_OPTIONS.map((o) => o.value));

export function isMessageLocale(code: string): boolean {
  return MESSAGE_LOCALE_CODES.has(code);
}
