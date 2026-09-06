'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { MARKETING_HOME_URL } from '@/constants/legalUrls';

/**
 * The "Powered by Aicser" credit shown at the bottom of every embed surface
 * (dashboard/chart/report/chat) — the actual UI half of the theme's
 * `hide_aicser_branding` flag (Settings > Embed > Branding, Team+ plan
 * gated server-side in src/modules/embed/router.py's
 * _enforce_white_label_entitlement). The flag existed and was already
 * plan-gated end-to-end, but nothing ever rendered a badge for it to
 * actually hide — this component is that badge.
 */
export function EmbedBrandingFooter({
  hidden,
  variant = 'floating',
}: {
  hidden?: boolean;
  /** 'floating': fixed pill over an iframe-style viewport (dashboard/chart/
   * chat). 'inline': flows with the document instead — for the report page,
   * a scrollable/printable document where a fixed-position badge would sit
   * over content or get cut off on PDF export. */
  variant?: 'floating' | 'inline';
}) {
  const t = useTranslations('common');
  if (hidden) return null;
  return (
    <a
      href={`${MARKETING_HOME_URL}?utm_source=embed&utm_medium=badge`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        position: variant === 'floating' ? 'fixed' : 'static',
        bottom: variant === 'floating' ? 8 : undefined,
        right: variant === 'floating' ? 10 : undefined,
        zIndex: variant === 'floating' ? 50 : undefined,
        display: 'inline-block',
        fontSize: 11,
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
