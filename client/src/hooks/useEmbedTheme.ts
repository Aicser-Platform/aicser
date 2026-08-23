'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/utils/api';
import type { EmbedTheme } from './useEmbedCode';

export type { EmbedTheme };

/**
 * Fetches the per-call theme stored on an embed token (see EmbedTab.tsx's
 * "Branding" section) and returns the inline style to spread onto the embed
 * page's root element. Overriding antd's own CSS custom properties here is
 * enough to re-theme every antd component the embedded view renders — they
 * all read color from `var(--ant-color-primary)` etc. rather than hardcoding it.
 */
export function useEmbedTheme(token: string | null | undefined): {
  theme: EmbedTheme | null;
  themeStyle: React.CSSProperties;
  /** Spread onto the root element as `data-theme={dataTheme}` — this is an HTML
   * attribute, not a CSS property, so it can't live inside `themeStyle`. */
  dataTheme: 'light' | 'dark' | undefined;
  loading: boolean;
} {
  const [theme, setTheme] = useState<EmbedTheme | null>(null);
  const [loading, setLoading] = useState(Boolean(token));

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchApi<{ theme?: EmbedTheme | null }>(`/api/embed/tokens/verify?token=${encodeURIComponent(token)}`)
      .then((res) => {
        if (!cancelled) setTheme(res.theme || null);
      })
      .catch(() => {
        // A theme fetch failure shouldn't block rendering the embedded content
        // itself — it just falls back to Aicser's default look.
        if (!cancelled) setTheme(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const themeStyle: React.CSSProperties = {};
  if (theme?.primary_color) {
    (themeStyle as Record<string, string>)['--ant-color-primary'] = theme.primary_color;
    (themeStyle as Record<string, string>)['--ant-color-primary-hover'] = theme.primary_color;
    (themeStyle as Record<string, string>)['--ant-color-link'] = theme.primary_color;
  }
  if (theme?.font_family) {
    themeStyle.fontFamily = theme.font_family;
  }
  const dataTheme: 'light' | 'dark' | undefined =
    theme?.mode === 'dark' || theme?.mode === 'light' ? theme.mode : undefined;

  return { theme, themeStyle, dataTheme, loading };
}
