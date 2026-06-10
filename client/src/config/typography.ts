/**
 * Multilingual typography — Noto Sans family with script-specific variants.
 * Used by layout, LocaleProvider, ThemeProvider, and BrandThemeProvider defaults.
 */

export const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?' +
  'family=Noto+Sans:wght@400;500;600;700&' +
  'family=Noto+Sans+SC:wght@400;500;600;700&' +
  'family=Noto+Sans+JP:wght@400;500;600;700&' +
  'family=Noto+Sans+Thai:wght@400;500;600;700&' +
  'family=Noto+Sans+Khmer:wght@400;500;600;700&' +
  'display=swap';

const SYSTEM_FALLBACK =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Full stack when locale is unknown — covers all supported scripts. */
export const MULTILINGUAL_FONT_STACK = [
  '"Noto Sans"',
  '"Noto Sans SC"',
  '"Noto Sans JP"',
  '"Noto Sans Thai"',
  '"Noto Sans Khmer"',
  SYSTEM_FALLBACK,
].join(', ');

/** Locale-optimized stacks — primary script family first for better shaping. */
export const LOCALE_FONT_STACK: Record<string, string> = {
  en: `"Noto Sans", ${SYSTEM_FALLBACK}`,
  id: `"Noto Sans", ${SYSTEM_FALLBACK}`,
  de: `"Noto Sans", ${SYSTEM_FALLBACK}`,
  es: `"Noto Sans", ${SYSTEM_FALLBACK}`,
  fr: `"Noto Sans", ${SYSTEM_FALLBACK}`,
  vi: `"Noto Sans", ${SYSTEM_FALLBACK}`,
  zh: `"Noto Sans SC", "Noto Sans", ${SYSTEM_FALLBACK}`,
  ja: `"Noto Sans JP", "Noto Sans", ${SYSTEM_FALLBACK}`,
  th: `"Noto Sans Thai", "Noto Sans", ${SYSTEM_FALLBACK}`,
  km: `"Noto Sans Khmer", "Noto Sans", ${SYSTEM_FALLBACK}`,
};

export function getFontStackForLocale(locale: string): string {
  return LOCALE_FONT_STACK[locale] || MULTILINGUAL_FONT_STACK;
}

export function applyTypographyForLocale(locale: string): void {
  if (typeof document === 'undefined') return;
  const stack = getFontStackForLocale(locale);
  document.documentElement.lang = locale;
  document.documentElement.dataset.locale = locale;
  document.documentElement.style.setProperty('--font-sans', stack);
  document.documentElement.style.setProperty('--ant-font-family', stack);
}
