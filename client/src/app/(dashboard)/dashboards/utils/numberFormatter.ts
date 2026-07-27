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
  return formatNumber(value, { decimals: 1, compact: true });
};

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
