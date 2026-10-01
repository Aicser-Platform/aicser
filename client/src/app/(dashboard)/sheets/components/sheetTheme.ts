/**
 * IronCalc's grid and toolbar take their colours from CSS variables; these come from the app's
 * Ant Design tokens so the sheet matches the rest of Aicser in light and dark mode.
 */
import type { GlobalToken } from 'antd';

const GREYS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;

type Rgba = [number, number, number, number];

/** '#rgb', '#rrggbb', 'rgb(…)' or 'rgba(…)' → channels (the grid is a canvas, which needs
 * plain colours — not CSS color-mix()). */
export function parseColor(c: string): Rgba {
  const s = c.trim();
  if (s.startsWith('#')) {
    const h = s.length === 4 ? s.slice(1).split('').map((x) => x + x).join('') : s.slice(1, 7);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const n = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
}

/** ``a`` over ``b`` at ``weight`` (alpha of ``a`` included), as an opaque rgb() colour. */
export function mix(a: string, b: string, weight: number): string {
  const [ar, ag, ab, aa] = parseColor(a);
  const [br, bg, bb] = parseColor(b);
  const w = Math.max(0, Math.min(1, weight * aa));
  const ch = (x: number, y: number) => Math.round(x * w + y * (1 - w));
  return `rgb(${ch(ar, br)}, ${ch(ag, bg)}, ${ch(ab, bb)})`;
}

/** ``color`` at ``alpha`` opacity, as rgba() (for fills drawn over cells, which must show through). */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function sheetThemeVariables(token: GlobalToken, dark: boolean): Record<string, string> {
  const bg = token.colorBgContainer;
  const text = token.colorText;
  // Grey scale from the page background (50) to the text colour (900), in either theme.
  const greys = Object.fromEntries(
    GREYS.map((g, i) => [`--palette-grey-${g}`, mix(text, bg, 0.04 + (i / (GREYS.length - 1)) * 0.86)]),
  );
  return {
    '--typography-font-family': token.fontFamily,
    '--typography-font-size': `${token.fontSizeSM}px`,
    // IronCalc paints cells with "white" and text with "black".
    '--palette-common-white': bg,
    '--palette-common-black': mix(text, bg, 1),
    '--palette-primary-main': token.colorPrimary,
    '--palette-primary-light': token.colorPrimaryBg,
    '--palette-primary-dark': token.colorPrimaryActive,
    '--palette-primary-contrast-text': token.colorTextLightSolid,
    '--palette-secondary-main': token.colorPrimary,
    '--palette-secondary-light': token.colorPrimaryBgHover,
    '--palette-secondary-dark': token.colorPrimaryActive,
    '--palette-secondary-contrast-text': token.colorTextLightSolid,
    '--palette-error-main': token.colorError,
    '--palette-error-light': token.colorErrorBg,
    '--palette-error-dark': token.colorErrorActive,
    '--palette-error-contrast-text': token.colorTextLightSolid,
    '--palette-warning-main': token.colorWarning,
    '--palette-warning-light': token.colorWarningBg,
    '--palette-warning-dark': token.colorWarningActive,
    '--palette-warning-contrast-text': token.colorTextLightSolid,
    '--palette-info-main': token.colorInfo,
    '--palette-info-light': token.colorInfoBg,
    '--palette-info-dark': token.colorInfoActive,
    '--palette-info-contrast-text': token.colorTextLightSolid,
    '--palette-success-main': token.colorSuccess,
    '--palette-success-light': token.colorSuccessBg,
    '--palette-success-dark': token.colorSuccessActive,
    '--palette-success-contrast-text': token.colorTextLightSolid,
    ...greys,
    '--palette-grey-a100': token.colorFillQuaternary,
    '--palette-grey-a200': token.colorFillTertiary,
    '--palette-grey-a400': token.colorFillSecondary,
    '--palette-grey-a700': token.colorFill,
    '--palette-sheet-header-corner-background': mix(token.colorFillQuaternary, bg, 1),
    '--palette-sheet-header-text-color': mix(token.colorTextSecondary, bg, 1),
    '--palette-sheet-header-background': mix(text, bg, dark ? 0.06 : 0.03),
    '--palette-sheet-header-global-selector-color': mix(token.colorBorder, bg, 1),
    '--palette-sheet-header-selected-background': mix(token.colorPrimary, bg, dark ? 0.22 : 0.12),
    '--palette-sheet-header-full-selected-background': token.colorPrimary,
    '--palette-sheet-header-selected-color': token.colorPrimary,
    '--palette-sheet-header-border-color': mix(token.colorBorderSecondary, bg, 1),
    '--palette-sheet-grid-color': mix(text, bg, dark ? 0.12 : 0.08),
    '--palette-sheet-grid-separator-color': mix(token.colorBorder, bg, 1),
    '--palette-sheet-default-text-color': mix(text, bg, 1),
    '--palette-sheet-outline-color': token.colorPrimary,
    '--palette-sheet-outline-editing-color': token.colorPrimaryHover,
    // The selection fill is painted over the cells: translucent, as in Excel and Google Sheets,
    // so the selected values stay readable.
    '--palette-sheet-outline-background-color': withAlpha(token.colorPrimary, dark ? 0.18 : 0.12),
  };
}

/**
 * Dark mode for the grid. Cells carry their own colours (black text and pastel fills from Excel
 * files and cell styles), which a dark palette alone can't fix; so, as spreadsheet apps do, the
 * grid is shown through `invert(1) hue-rotate(180deg)`: lightness flips, hue stays — black text
 * turns white, a pink "Bad" fill a deep red. The filter undoes itself, so the grid's own palette
 * is passed through it first and comes out as the app's dark palette.
 */
export const DARK_GRID_FILTER = 'invert(1) hue-rotate(180deg)';

export function throughDarkFilter(color: string): string {
  const [r0, g0, b0, a] = parseColor(color);
  const [r, g, b] = [255 - r0, 255 - g0, 255 - b0];
  // CSS hue-rotate(180deg) matrix (Filter Effects spec, cos = -1, sin = 0).
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const out = [
    clamp(-0.574 * r + 1.43 * g + 0.144 * b),
    clamp(0.426 * r + 0.43 * g + 0.144 * b),
    clamp(0.426 * r + 1.43 * g - 0.856 * b),
  ];
  return a < 1 ? `rgba(${out.join(', ')}, ${a})` : `rgb(${out.join(', ')})`;
}

const COLOR = /^(#|rgb)/i;

/** The grid palette to hand IronCalc so that, seen through the dark filter, it is `vars`. */
export function forDarkGrid(vars: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, COLOR.test(v.trim()) ? throughDarkFilter(v) : v]));
}

/** CSS declarations for a set of variables. */
export function declarations(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('');
}

/**
 * The sheet's CSS. IronCalc reads the grid's colours once, when the grid is created, and sets its
 * variables late (and removes them on unmount); so they are also given here as a stylesheet
 * rule that exists before the grid is built — a theme switch then shows the right colours at once.
 * In dark mode the chrome takes the dark palette and the grid (pre-filtered) is shown through the
 * dark filter. The grid's native scrollbars are drawn light so they come out dark after the
 * filter (the page's own dark scrollbars would come out light).
 */
export function sheetCss(root: Record<string, string>, chrome: Record<string, string> | null): string {
  const rules = [
    `.wb-grid,.wb-preview{${declarations(root)}}`,
    `.wb-grid .ic-worksheet-wrapper,.wb-preview .ic-worksheet-wrapper{scrollbar-color:var(--palette-grey-400) var(--palette-common-white);}`,
  ];
  if (chrome) {
    const scope = '.wb-grid--dark';
    rules.push(
      `${scope}{color-scheme:dark;}`,
      `${scope} *{${declarations(chrome)}}`,
      `${scope} .ic-worksheet-wrapper,${scope} .ic-worksheet-wrapper *{${declarations(root)}}`,
      `${scope} .ic-worksheet-wrapper{filter:${DARK_GRID_FILTER};color-scheme:light;}`,
    );
  }
  return rules.join('\n');
}
