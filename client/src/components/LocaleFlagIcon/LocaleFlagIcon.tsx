'use client';

import React from 'react';
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

const EMOJI_BY_LOCALE: Record<string, string> = {
  en: '🇺🇸',
  id: '🇮🇩',
  zh: '🇨🇳',
  fr: '🇫🇷',
  de: '🇩🇪',
  ja: '🇯🇵',
  km: '🇰🇭',
  es: '🇪🇸',
  th: '🇹🇭',
  vi: '🇻🇳',
};

export type LocaleFlagIconProps = {
  locale: string;
  /** Width in px; height follows 3:2 ratio. */
  width?: number;
  className?: string;
  title?: string;
};

export function LocaleFlagIcon({ locale, width = 20, className, title }: LocaleFlagIconProps) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const countryCode = COUNTRY_CODE_BY_LOCALE[locale] ?? 'us';
  const fallbackEmoji = EMOJI_BY_LOCALE[locale] ?? '🌐';
  const src = `https://flagcdn.com/w40/${countryCode}.png`;

  if (imageFailed) {
    return (
      <span
        title={title}
        className={className}
        aria-hidden
        style={{
          width,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          fontSize: Math.max(12, Math.round(width * 0.82)),
          flexShrink: 0,
        }}
      >
        {fallbackEmoji}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={title ?? locale}
      title={title}
      className={className}
      aria-hidden
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setImageFailed(true)}
      style={{
        width,
        height: 'auto',
        display: 'block',
        flexShrink: 0,
        borderRadius: 2,
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.08)',
      }}
    />
  );
}
