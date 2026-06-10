'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

/** Visually hidden until focused — skips to main content for keyboard users. */
export function SkipToContentLink() {
  const t = useTranslations('layout');

  return (
    <a
      href="#main-content"
      className="skip-to-content-link"
      style={{
        position: 'absolute',
        left: 8,
        top: 8,
        zIndex: 10000,
        padding: '8px 16px',
        background: 'var(--ant-color-primary)',
        color: '#fff',
        borderRadius: 6,
        textDecoration: 'none',
        transform: 'translateY(-120%)',
        transition: 'transform 0.2s ease',
      }}
      onFocus={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
      }}
      onBlur={(e) => {
        e.currentTarget.style.transform = 'translateY(-120%)';
      }}
    >
      {t('skip_to_content')}
    </a>
  );
}
