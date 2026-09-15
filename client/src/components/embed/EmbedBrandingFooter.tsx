'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { MARKETING_HOME_URL } from '@/constants/legalUrls';

/**
 * The "Powered by Aicser" credit shown on embed surfaces
 * (dashboard/chart/report/chat) — UI half of `hide_aicser_branding`
 * (Settings > Embed > Branding, Team+ gated).
 *
 * Prefer ``variant="inline"`` anywhere the surface has bottom chrome
 * (chat composer, forms). ``floating`` is for full-bleed viewports
 * (dashboard/chart) without overlapping controls.
 */
export function EmbedBrandingFooter({
  hidden,
  variant = 'floating',
}: {
  hidden?: boolean;
  /** 'floating': fixed pill for iframe-style viewports without bottom controls.
   * 'inline': document flow — use under chat composers / printable reports. */
  variant?: 'floating' | 'inline';
}) {
  const t = useTranslations('common');
  if (hidden) return null;
  return (
    <a
      href={`${MARKETING_HOME_URL}?utm_source=embed&utm_medium=badge`}
      target="_blank"
      rel="noopener noreferrer"
      className={`embed-branding-footer embed-branding-footer--${variant}`}
      style={{
        position: variant === 'floating' ? 'fixed' : 'static',
        bottom: variant === 'floating' ? 8 : undefined,
        right: variant === 'floating' ? 10 : undefined,
        zIndex: variant === 'floating' ? 50 : undefined,
        display: 'inline-block',
        fontSize: 11,
        lineHeight: 1.3,
        padding: '3px 8px',
        borderRadius: 999,
        background: 'var(--ant-color-bg-elevated, rgba(255,255,255,0.9))',
        border: '1px solid var(--ant-color-border, rgba(0,0,0,0.08))',
        color: 'var(--ant-color-text-tertiary, #8c8c8c)',
        textDecoration: 'none',
        boxShadow: variant === 'floating' ? '0 1px 4px rgba(0,0,0,0.08)' : undefined,
        pointerEvents: 'auto',
      }}
    >
      {t('powered_by')}
    </a>
  );
}

export default EmbedBrandingFooter;
