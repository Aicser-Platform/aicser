'use client';

import type { EmbedTheme } from './useEmbedCode';

export type { EmbedTheme };

/**
 * The inline style for an embed page's root element from the theme stored on its embed token
 * (see EmbedTab.tsx's "Branding" section), which the page receives when it opens its session
 * (useEmbedSession). Overriding antd's own CSS custom properties here is enough to re-theme
 * every antd component the embedded view renders — they all read color from
 * `var(--ant-color-primary)` etc. rather than hardcoding it.
 */
export function useEmbedTheme(theme: EmbedTheme | null | undefined): {
  theme: EmbedTheme | null;
  themeStyle: React.CSSProperties;
  /** Spread onto the root element as `data-theme={dataTheme}` — this is an HTML
   * attribute, not a CSS property, so it can't live inside `themeStyle`. */
  dataTheme: 'light' | 'dark' | undefined;
} {
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

  return { theme: theme || null, themeStyle, dataTheme };
}
