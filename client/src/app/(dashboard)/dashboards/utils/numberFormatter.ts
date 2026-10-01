/**
 * Number formatting utilities for dashboard widgets
 * Provides consistent formatting across all chart types and stat displays
 */

export interface NumberFormatOptions {
  decimals?: number;
  currency?: boolean;
  /** Currency / unit prefix when currency=true. Default '$'. */
  currencySymbol?: string;
  percent?: boolean;
  compact?: boolean;
  prefix?: string;
  suffix?: string;
}

/**
 * Format a number with compact notation (k, M, B) and proper decimal handling
 */
export const formatNumber = (value: number | string | null | undefined, options: NumberFormatOptions = {}): string => {
  // Handle null, undefined, or invalid values
  if (value === null || value === undefined || value === '') {
    return '0';
  }

  const numValue = typeof value === 'string' ? parseFloat(value) : value;

  // Handle NaN or invalid numbers
  if (isNaN(numValue)) {
    return '0';
  }

  const {
    decimals = 2,
    currency = false,
    currencySymbol = '$',
    percent = false,
    compact = true,
    prefix = '',
    suffix = '',
  } = options;

  let formattedValue: string;
  const absValue = Math.abs(numValue);

  // Handle percentage formatting.
  // Values already on a 0–100 (or larger) scale must NOT be multiplied again —
  // only unit-interval ratios (|v| ≤ 1) are scaled ×100 (industry-standard).
  if (percent) {
    const scaled = Math.abs(numValue) <= 1 ? numValue * 100 : numValue;
    const absScaled = Math.abs(scaled);
    if (compact && absScaled >= 1000) {
      if (absScaled >= 1_000_000_000) {
        formattedValue = (scaled / 1_000_000_000).toFixed(decimals) + 'B%';
      } else if (absScaled >= 1_000_000) {
        formattedValue = (scaled / 1_000_000).toFixed(decimals) + 'M%';
      } else {
        formattedValue = (scaled / 1_000).toFixed(decimals) + 'k%';
      }
    } else {
      formattedValue = scaled.toFixed(decimals) + '%';
    }
  }
  // Handle compact notation for large numbers
  else if (compact && absValue >= 1000) {
    if (absValue >= 1_000_000_000) {
      formattedValue = (numValue / 1_000_000_000).toFixed(decimals) + 'B';
    } else if (absValue >= 1_000_000) {
      formattedValue = (numValue / 1_000_000).toFixed(decimals) + 'M';
    } else if (absValue >= 1_000) {
      formattedValue = (numValue / 1_000).toFixed(decimals) + 'k';
    } else {
      formattedValue = numValue.toFixed(decimals);
    }
  }
  // Handle regular number formatting with decimal control
  else {
    // For small numbers, reduce unnecessary decimals
    const effectiveDecimals = absValue >= 1 ? Math.min(decimals, 2) : decimals;
    formattedValue = numValue.toFixed(effectiveDecimals);

    // Remove trailing zeros after decimal point
    if (formattedValue.includes('.')) {
      formattedValue = formattedValue.replace(/\.?0+$/, '');
    }
  }

  // Add currency prefix if specified
  if (currency) {
    formattedValue = `${currencySymbol || '$'}${formattedValue}`;
  }

  // Add custom prefix and suffix
  formattedValue = prefix + formattedValue + suffix;

  return formattedValue;
};

/**
 * Format numbers for chart axis labels
 */
export const formatAxisLabel = (value: number): string => {
  // Decimals follow magnitude: a fixed 1 decimal turned every rate axis (0.105, 0.11, 0.115)
  // into "0.1, 0.1, 0.1".
  const abs = Math.abs(Number(value));
  if (abs > 0 && abs < 10 && !Number.isInteger(Number(value))) {
    const decimals = Math.min(4, Math.max(1, Math.ceil(-Math.log10(abs)) + 2));
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: decimals });
  }
  return formatNumber(value, { decimals: 1, compact: true });
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Category labels for date buckets, in the granularity the data actually has:
 * every value on the 1st of a month → "Jan 2024"; every value on 1 Jan → "2024"; plain days →
 * "5 Jan 2024"; a real time of day is kept. Non-dates pass through unchanged. Raw
 * "2024-01-01T00:00:00" labels are what the axis used to show.
 */
export function makeCategoryLabelFormatter(
  values: unknown[] | undefined,
  locale?: string,
  booleanLabels?: { yes: string; no: string },
): (v: unknown) => string {
  // A true/false column reads as Yes / No, not the raw "true" / "false".
  const asBool = (v: unknown): boolean | null =>
    typeof v === 'boolean' ? v : typeof v === 'string' && /^(true|false)$/i.test(v.trim()) ? v.trim().toLowerCase() === 'true' : null;
  if (booleanLabels && values && values.length > 0 && values.every((v) => asBool(v) !== null)) {
    return (v) => {
      const b = asBool(v);
      return b === null ? `${v ?? ''}` : b ? booleanLabels.yes : booleanLabels.no;
    };
  }
  // Blank buckets (null / "") don't decide the column's type: one missing week used to leave
  // every label as a raw "2024-01-01T00:00:00".
  const present = (values || []).filter((v) => v !== null && v !== undefined && v !== '');
  const parsed = present.map((v) => (typeof v === 'string' ? ISO_DATE.exec(v.trim()) : null));
  const allDates = parsed.length > 0 && parsed.every(Boolean);
  if (!allDates) return (v) => `${v ?? ''}`;
  const hasTime = parsed.some((m) => m && ((m[4] && m[4] !== '00') || (m[5] && m[5] !== '00')));
  const monthly = parsed.every((m) => m && m[3] === '01');
  const yearly = monthly && parsed.every((m) => m && m[2] === '01');
  const fmt = new Intl.DateTimeFormat(
    locale,
    hasTime
      ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
      : yearly
        ? { year: 'numeric', timeZone: 'UTC' }
        : monthly
          ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
          : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },
  );
  return (v) => {
    const m = typeof v === 'string' ? ISO_DATE.exec(v.trim()) : null;
    if (!m) return `${v ?? ''}`;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)));
    return Number.isNaN(d.getTime()) ? `${v}` : fmt.format(d);
  };
}

/**
 * Format numbers for chart tooltips with more detail
 */
export const formatTooltipValue = (
  value: number,
  format?: 'currency' | 'percent' | 'number',
  currencySymbol?: string,
): string => {
  switch (format) {
    case 'currency':
      return formatNumber(value, { currency: true, currencySymbol, decimals: 2, compact: true });
    case 'percent':
      return formatNumber(value, { percent: true, decimals: 1, compact: false });
    case 'number':
    default:
      return formatNumber(value, { decimals: 2, compact: true });
  }
};

/**
 * Format numbers for stat widgets (KPI displays)
 */
export const formatStatValue = (
  value: number | string,
  format?: 'currency' | 'percent' | 'number',
  currencySymbol?: string,
  unitSuffix?: string,
): string => {
  let formatted: string;
  switch (format) {
    case 'currency':
      formatted = formatNumber(value, { currency: true, currencySymbol, decimals: 2, compact: true });
      break;
    case 'percent':
      formatted = formatNumber(value, { percent: true, decimals: 1, compact: false });
      break;
    case 'number':
    default:
      formatted = formatNumber(value, { decimals: 2, compact: true });
  }
  if (unitSuffix && format !== 'currency' && format !== 'percent') {
    return `${formatted}${unitSuffix}`;
  }
  return formatted;
};

/**
 * Get appropriate decimal places based on number magnitude
 */
export const getOptimalDecimals = (value: number): number => {
  const absValue = Math.abs(value);
  if (absValue >= 1000) return 1;
  if (absValue >= 10) return 2;
  if (absValue >= 1) return 2;
  if (absValue >= 0.1) return 3;
  return 4;
};

/**
 * Format number for table cells with smart decimal handling
 */
export const formatTableValue = (
  value: number | string | null | undefined,
  format?: 'currency' | 'percent' | 'number'
): string => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) return '-';

  const decimals = getOptimalDecimals(numValue);

  switch (format) {
    case 'currency':
      return formatNumber(numValue, { currency: true, decimals, compact: true });
    case 'percent':
      return formatNumber(numValue, { percent: true, decimals: 1, compact: false });
    case 'number':
    default:
      return formatNumber(numValue, { decimals, compact: true });
  }
};
