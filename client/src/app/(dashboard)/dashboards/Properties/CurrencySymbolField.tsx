'use client';

import React, { useMemo } from 'react';
import { AutoComplete } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { PpLabel } from './PpLabel';

/** Common currencies first; anything else can be typed (a symbol or a code). */
const COMMON_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'KHR', 'THB', 'VND', 'IDR', 'SGD', 'MYR', 'PHP',
  'KRW', 'AUD', 'CAD', 'CHF', 'HKD', 'NZD', 'BRL', 'MXN', 'ZAR', 'AED', 'SAR',
];

/**
 * The symbol a currency is written with, unambiguous across currencies ("A$", "CA$", "€", "៛").
 * Letter symbols ("CHF") get a trailing space so amounts read "CHF 1.2K".
 */
export function currencySymbolFor(code: string): string {
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'symbol' })
      .formatToParts(1)
      .find((p) => p.type === 'currency')?.value;
    if (!part) return code;
    return /^[A-Za-z]+$/.test(part) ? `${part} ` : part;
  } catch {
    return `${code} `;
  }
}

function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) || code;
  } catch {
    return code;
  }
}

/** Currency for amounts: pick a common one or type any symbol. Empty means "$". */
export function CurrencySymbolField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (symbol: string) => void;
}) {
  const locale = useLocale();
  const t = useTranslations('chart_specific_fields');
  const options = useMemo(
    () =>
      COMMON_CURRENCIES.map((code) => {
        const symbol = currencySymbolFor(code);
        return {
          value: symbol,
          label: (
            <span className="pp-currency-option">
              <span className="pp-currency-symbol">{symbol.trim()}</span>
              {currencyName(code, locale)}
              <span className="pp-currency-code">{code}</span>
            </span>
          ),
          search: `${code} ${currencyName(code, locale)} ${symbol}`.toLowerCase(),
        };
      }),
    [locale],
  );

  return (
    <div>
      <PpLabel tip={hint}>{label}</PpLabel>
      <AutoComplete
        size="small"
        style={{ width: '100%' }}
        value={value}
        options={options}
        placeholder={t('currency_placeholder')}
        onChange={(v) => onChange(String(v ?? ''))}
        filterOption={(input, option) =>
          !input || Boolean((option as { search?: string })?.search?.includes(input.toLowerCase()))
        }
        allowClear
        popupMatchSelectWidth={260}
      />
    </div>
  );
}
