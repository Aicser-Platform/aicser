/**
 * Shared locale/language options for the application.
 * Single source of truth to avoid duplication across Profile, Appearance, and Settings.
 * Default: English (en). Includes Khmer, Vietnamese, Bahasa, Mandarin/Chinese.
 */

export const DEFAULT_LOCALE = 'en' as const;

export interface LocaleOption {
  value: string;
  /** English UI label (settings, headers). */
  label: string;
  /** Regional indicator flag emoji (fallback / non-React contexts); UI uses `LocaleFlagIcon`. */
  flag: string;
  /** Endonym / native language name (tooltips, accessibility). */
  nativeName: string;
  /** English region or variant label for tooltips (e.g. United States). */
  regionEn: string;
}

/** All supported locales. English first (default), then alphabetical by label. */
export const LOCALE_OPTIONS: LocaleOption[] = [
  { value: 'en', label: 'English', flag: '🇺🇸', nativeName: 'English', regionEn: 'United States' },
  { value: 'id', label: 'Bahasa (Indonesian)', flag: '🇮🇩', nativeName: 'Bahasa Indonesia', regionEn: 'Indonesia' },
  { value: 'zh', label: 'Chinese (Mandarin)', flag: '🇨🇳', nativeName: '中文', regionEn: 'China (Mandarin)' },
  { value: 'fr', label: 'French', flag: '🇫🇷', nativeName: 'Français', regionEn: 'France' },
  { value: 'de', label: 'German', flag: '🇩🇪', nativeName: 'Deutsch', regionEn: 'Germany' },
  { value: 'ja', label: 'Japanese', flag: '🇯🇵', nativeName: '日本語', regionEn: 'Japan' },
  { value: 'km', label: 'Khmer', flag: '🇰🇭', nativeName: 'ភាសាខ្មែរ', regionEn: 'Cambodia' },
  { value: 'es', label: 'Spanish', flag: '🇪🇸', nativeName: 'Español', regionEn: 'Spain' },
  { value: 'th', label: 'Thai', flag: '🇹🇭', nativeName: 'ไทย', regionEn: 'Thailand' },
  { value: 'vi', label: 'Vietnamese', flag: '🇻🇳', nativeName: 'Tiếng Việt', regionEn: 'Vietnam' },
];

const EN_META = LOCALE_OPTIONS[0];

export function getLocaleLabel(value: string): string {
  return LOCALE_OPTIONS.find((o) => o.value === value)?.label ?? EN_META.label;
}

export function getLocaleMeta(value: string): LocaleOption {
  return LOCALE_OPTIONS.find((o) => o.value === value) ?? EN_META;
}

/** Timezone options for Language & region. Common zones + UTC. */
export interface TimezoneOption {
  value: string;
  label: string;
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern (US)' },
  { value: 'America/Chicago', label: 'Central (US)' },
  { value: 'America/Denver', label: 'Mountain (US)' },
  { value: 'America/Los_Angeles', label: 'Pacific (US)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'Europe/Moscow', label: 'Moscow' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Kolkata', label: 'India' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Shanghai', label: 'Shanghai' },
  { value: 'Asia/Bangkok', label: 'Bangkok' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'Asia/Phnom_Penh', label: 'Phnom Penh' },
];

/** Date format options. */
export const DATE_FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
  { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY' },
];

/** Currency options for display/formatting. */
export const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'JPY', label: 'JPY' },
  { value: 'CNY', label: 'CNY' },
  { value: 'INR', label: 'INR' },
  { value: 'AUD', label: 'AUD' },
  { value: 'CAD', label: 'CAD' },
  { value: 'CHF', label: 'CHF' },
  { value: 'KRW', label: 'KRW' },
  { value: 'KHR', label: 'KHR' },
  { value: 'SGD', label: 'SGD' },
  { value: 'THB', label: 'THB' },
  { value: 'VND', label: 'VND' },
  { value: 'MYR', label: 'MYR' },
  { value: 'PHP', label: 'PHP' },
  { value: 'IDR', label: 'IDR' },
  { value: 'HKD', label: 'HKD' },
  { value: 'NZD', label: 'NZD' },
];
