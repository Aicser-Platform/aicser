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
  const countryCode = COUNTRY_CODE_BY_LOCALE[locale] ?? 'us';
  const emoji = EMOJI_BY_LOCALE[locale] ?? '🌐';
  const src = `https://flagcdn.com/w40/${countryCode}.png`;
  const [imageFailed, setImageFailed] = React.useState(false);
  const showImage = !imageFailed;

  return (
    <span
      title={title}
      className={className}
      aria-hidden
      style={{
        width,
        height: Math.round(width * 0.68),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
        fontSize: Math.max(14, Math.round(width * 0.82)),
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 2,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'inherit',
          lineHeight: 1,
        }}
      >
        {emoji}
      </span>
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          style={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            borderRadius: 2,
          }}
        />
      ) : null}
    </span>
  );
}
