'use client';

import React from 'react';
import { CountryFlagIcon } from '@/components/CountryFlagIcon/CountryFlagIcon';

/** Maps app locale codes (`LOCALE_OPTIONS[].value`) to ISO 3166-1 alpha-2 country codes. */
const COUNTRY_CODE_BY_LOCALE: Record<string, string> = {
  en: 'us',
  id: 'id',
  zh: 'cn',
  fr: 'fr',
  de: 'de',
  ja: 'jp',
  km: 'kh',
  es: 'es',
  th: 'th',
  vi: 'vn',
};

export type LocaleFlagIconProps = {
  locale: string;
  /** Width in px; height follows 3:2 ratio. */
  width?: number;
  className?: string;
  title?: string;
};

export function LocaleFlagIcon({ locale, width = 20, className, title }: LocaleFlagIconProps) {
  const countryCode = COUNTRY_CODE_BY_LOCALE[locale] ?? 'us';
  return <CountryFlagIcon countryCode={countryCode} width={width} className={className} title={title} />;
}
