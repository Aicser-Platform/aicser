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
  /** Current UTC offset (DST-aware), e.g. "GMT-5". Computed at load time. */
  offset: string;
}

function getTimezoneOffset(timeZone: string): string {
  if (timeZone === 'UTC') return 'GMT+0';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

const RAW_TIMEZONES: { value: string; label: string }[] = [
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

export const TIMEZONE_OPTIONS: TimezoneOption[] = RAW_TIMEZONES.map((tz) => ({
  ...tz,
  offset: getTimezoneOffset(tz.value),
}));

/** Date format options. `example` is the current date rendered in that pattern, for a live preview. */
export interface DateFormatOption {
  value: string;
  label: string;
  example: string;
}

function formatDateExample(pattern: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const yyyy = String(d.getFullYear());
  switch (pattern) {
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'DD/MM/YYYY':
      return `${dd}/${mm}/${yyyy}`;
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    case 'DD.MM.YYYY':
      return `${dd}.${mm}.${yyyy}`;
    default:
      return `${mm}/${dd}/${yyyy}`;
  }
}

export const DATE_FORMAT_OPTIONS: DateFormatOption[] = [
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY', example: formatDateExample('MM/DD/YYYY') },
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY', example: formatDateExample('DD/MM/YYYY') },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD', example: formatDateExample('YYYY-MM-DD') },
  { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY', example: formatDateExample('DD.MM.YYYY') },
];

/** Currency options for display/formatting, with their standard symbol for quick recognition. */
export interface CurrencyOption {
  value: string;
  label: string;
  symbol: string;
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { value: 'USD', label: 'USD', symbol: '$' },
  { value: 'EUR', label: 'EUR', symbol: '€' },
  { value: 'GBP', label: 'GBP', symbol: '£' },
  { value: 'JPY', label: 'JPY', symbol: '¥' },
  { value: 'CNY', label: 'CNY', symbol: 'CN¥' },
  { value: 'INR', label: 'INR', symbol: '₹' },
  { value: 'AUD', label: 'AUD', symbol: 'A$' },
  { value: 'CAD', label: 'CAD', symbol: 'C$' },
  { value: 'CHF', label: 'CHF', symbol: 'CHF' },
  { value: 'KRW', label: 'KRW', symbol: '₩' },
  { value: 'KHR', label: 'KHR', symbol: '៛' },
  { value: 'SGD', label: 'SGD', symbol: 'S$' },
  { value: 'THB', label: 'THB', symbol: '฿' },
  { value: 'VND', label: 'VND', symbol: '₫' },
  { value: 'MYR', label: 'MYR', symbol: 'RM' },
  { value: 'PHP', label: 'PHP', symbol: '₱' },
  { value: 'IDR', label: 'IDR', symbol: 'Rp' },
  { value: 'HKD', label: 'HKD', symbol: 'HK$' },
  { value: 'NZD', label: 'NZD', symbol: 'NZ$' },
];
