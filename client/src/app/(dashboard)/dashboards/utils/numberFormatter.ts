/**
 * Number formatting utilities for dashboard widgets
 * Provides consistent formatting across all chart types and stat displays
 */

export interface NumberFormatOptions {
  decimals?: number;
  currency?: boolean;
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

  const { decimals = 2, currency = false, percent = false, compact = true, prefix = '', suffix = '' } = options;

  let formattedValue: string;
  const absValue = Math.abs(numValue);
  const isNegative = numValue < 0;

  // Handle percentage formatting
  if (percent) {
    formattedValue = (numValue * 100).toFixed(decimals) + '%';
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
    const currencySymbol = '$'; // Could be configurable
    formattedValue = currencySymbol + formattedValue;
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
export const formatTooltipValue = (value: number, format?: 'currency' | 'percent' | 'number'): string => {
  switch (format) {
    case 'currency':
      return formatNumber(value, { currency: true, decimals: 2, compact: true });
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
export const formatStatValue = (value: number | string, format?: 'currency' | 'percent' | 'number'): string => {
  switch (format) {
    case 'currency':
      return formatNumber(value, { currency: true, decimals: 2, compact: true });
    case 'percent':
      return formatNumber(value, { percent: true, decimals: 1, compact: false });
    case 'number':
    default:
      return formatNumber(value, { decimals: 2, compact: true });
  }
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
