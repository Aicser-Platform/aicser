'use client';

import React from 'react';

export type CountryFlagIconProps = {
  /** ISO 3166-1 alpha-2 code, case-insensitive (e.g. "us", "JP"). */
  countryCode: string;
  /** Width in px; height follows a 3:2 flag ratio. */
  width?: number;
  className?: string;
  title?: string;
};

/**
 * Renders a country flag from flagcdn.com, with a regional-indicator emoji
 * underneath as both a fallback (image blocked/offline/CDN down) and an
 * instant-paint placeholder while the image loads. Shared by LocaleFlagIcon
 * (10 UI languages) and the Profile "Location" country picker (full ISO
 * list) so the two don't duplicate the same render logic.
 */
export function CountryFlagIcon({ countryCode, width = 20, className, title }: CountryFlagIconProps) {
  const code = (countryCode || 'us').toLowerCase();
  const emoji = countryCodeToEmoji(code);
  const src = `https://flagcdn.com/w40/${code}.png`;
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

/** ISO alpha-2 -> regional indicator emoji (e.g. "us" -> 🇺🇸), computed rather
 * than listed one-by-one since it's a pure mechanical offset from 'a'/'A'. */
export function countryCodeToEmoji(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return '🌐';
  const REGIONAL_INDICATOR_A = 0x1f1e6;
  const chars = [...upper].map((c) => {
    const offset = c.charCodeAt(0) - 65; // 'A'
    if (offset < 0 || offset > 25) return null;
    return String.fromCodePoint(REGIONAL_INDICATOR_A + offset);
  });
  return chars.every(Boolean) ? chars.join('') : '🌐';
}
