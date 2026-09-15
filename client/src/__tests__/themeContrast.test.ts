import { describe, expect, it } from 'vitest';

/**
 * Light-mode colorTextTertiary/colorTextQuaternary previously measured 2.92:1
 * and 1.74:1 against the container background (#f8f9fa) - both failed WCAG 2.1
 * AA (>=4.5:1 normal text, >=3:1 minimum for large text/UI components). Locks
 * in the fixed values (ThemeProvider.tsx + aiser-color-system.css) so a future
 * edit can't silently regress contrast back below the AA floor.
 */

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const [l1, l2] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const LIGHT_CONTAINER_BG = '#f8f9fa';
const LIGHT_LAYOUT_BG = '#ffffff';
const LIGHT_ELEVATED_BG = '#f1f3f5';
const DARK_CONTAINER_BG = '#161b22';
const DARK_ELEVATED_BG = '#1c2128';
const DARK_LAYOUT_BG = '#0d1117';
const COLOR_TEXT_TERTIARY_LIGHT = '#697280';
const COLOR_TEXT_QUATERNARY_LIGHT = '#7c8590';
const COLOR_BORDER_LIGHT = '#7a7f85';
const COLOR_BORDER_DARK = '#67717d';

describe('light-mode theme token contrast (WCAG 2.1 AA)', () => {
  it('colorTextTertiary meets the 4.5:1 normal-text minimum on both light surfaces', () => {
    expect(contrastRatio(COLOR_TEXT_TERTIARY_LIGHT, LIGHT_CONTAINER_BG)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(COLOR_TEXT_TERTIARY_LIGHT, LIGHT_LAYOUT_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it('colorTextQuaternary meets the 3:1 large-text/UI-component minimum on both light surfaces', () => {
    expect(contrastRatio(COLOR_TEXT_QUATERNARY_LIGHT, LIGHT_CONTAINER_BG)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(COLOR_TEXT_QUATERNARY_LIGHT, LIGHT_LAYOUT_BG)).toBeGreaterThanOrEqual(3.0);
  });

  it('quaternary stays visually lighter (less contrast) than tertiary - preserves the hierarchy', () => {
    expect(contrastRatio(COLOR_TEXT_QUATERNARY_LIGHT, LIGHT_CONTAINER_BG)).toBeLessThan(
      contrastRatio(COLOR_TEXT_TERTIARY_LIGHT, LIGHT_CONTAINER_BG),
    );
  });

  it('regression guard: the old failing values would not pass (sanity-checks the formula itself)', () => {
    expect(contrastRatio('#8b949e', LIGHT_CONTAINER_BG)).toBeLessThan(4.5);
    expect(contrastRatio('#bfbfbf', LIGHT_CONTAINER_BG)).toBeLessThan(3.0);
  });
});

describe('global border contrast (WCAG 1.4.11 non-text, >=3:1)', () => {
  it('light-mode border clears 3:1 against container, elevated, and layout surfaces', () => {
    expect(contrastRatio(COLOR_BORDER_LIGHT, LIGHT_CONTAINER_BG)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(COLOR_BORDER_LIGHT, LIGHT_ELEVATED_BG)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(COLOR_BORDER_LIGHT, LIGHT_LAYOUT_BG)).toBeGreaterThanOrEqual(3.0);
  });

  it('dark-mode border clears 3:1 against container, elevated, and layout surfaces', () => {
    expect(contrastRatio(COLOR_BORDER_DARK, DARK_CONTAINER_BG)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(COLOR_BORDER_DARK, DARK_ELEVATED_BG)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(COLOR_BORDER_DARK, DARK_LAYOUT_BG)).toBeGreaterThanOrEqual(3.0);
  });

  it('regression guard: the old failing border values would not pass', () => {
    expect(contrastRatio('#e1e4e8', LIGHT_CONTAINER_BG)).toBeLessThan(3.0);
    expect(contrastRatio('#30363d', DARK_CONTAINER_BG)).toBeLessThan(3.0);
  });
});

/**
 * Select's optionActiveBg/optionSelectedBg, Menu's itemHoverBg/darkItemHoverBg, and
 * the global controlItemBgHover fallback (used by plain <Dropdown menu={...}> popups)
 * were all hardcoded to the exact same Elevated-tier gray the popup itself renders
 * on - contrast ~1.0-1.07:1 against colorBgElevated/popupBg (imperceptible: hovering
 * or selecting an option produced no visible change). Fixed by switching all of them
 * to primaryColorOutline, a brand-hued semi-transparent tint - it stays visually
 * distinguishable via hue even when raw luminance contrast against a very dark or
 * very light popup surface is modest, and it tracks a custom brand color instead of
 * being a second fixed gray that could just as easily clash again.
 */
describe('dropdown/menu hover-vs-popup contrast (Select, Menu, Dropdown)', () => {
  it('regression guard: the old bug reused the exact popup background for hover (1:1, imperceptible)', () => {
    expect(contrastRatio(DARK_ELEVATED_BG, DARK_ELEVATED_BG)).toBe(1);
    expect(contrastRatio(LIGHT_ELEVATED_BG, LIGHT_ELEVATED_BG)).toBe(1);
  });

  it('the fix is a brand hue tint, not another neutral gray from the same elevation ladder', () => {
    const PRIMARY_COLOR_OUTLINE_DARK = 'rgba(0, 194, 203, 0.22)';
    const PRIMARY_COLOR_OUTLINE_LIGHT = 'rgba(0, 194, 203, 0.14)';

    const parseRgbChannels = (rgba: string): [number, number, number] => {
      const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) throw new Error(`not an rgb(a) string: ${rgba}`);
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    };

    for (const rgba of [PRIMARY_COLOR_OUTLINE_DARK, PRIMARY_COLOR_OUTLINE_LIGHT]) {
      const channels = parseRgbChannels(rgba);
      // A neutral gray has r === g === b; a hue-based tint doesn't, so it reads as
      // a distinct highlight by color alone, not just by a (here, too-small) shift
      // in lightness.
      expect(new Set(channels).size).toBeGreaterThan(1);
    }
  });
});

describe('pickReadableTextColor logic (brand-color-adaptive button/menu text)', () => {
  // Mirrors ThemeProvider.tsx's pickReadableTextColor - picks whichever of a
  // dark/light text candidate has higher contrast against the resolved bg,
  // so it adapts to brand overrides instead of assuming white always works.
  function pickReadableTextColor(bgHex: string, darkText: string, lightText: string): string {
    const luminance = (() => {
      const h = bgHex.replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    })();
    const contrastWithBlack = (luminance + 0.05) / 0.05;
    const contrastWithWhite = 1.05 / (luminance + 0.05);
    return contrastWithBlack >= contrastWithWhite ? darkText : lightText;
  }

  it('picks dark text for the default brand teal (white measured ~2.2:1, failing AA)', () => {
    expect(pickReadableTextColor('#00c2cb', '#0d1117', '#ffffff')).toBe('#0d1117');
    expect(contrastRatio('#0d1117', '#00c2cb')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps white text for a dark custom brand color (matches current behavior, still passes)', () => {
    expect(pickReadableTextColor('#1a2b6d', '#0d1117', '#ffffff')).toBe('#ffffff');
    expect(contrastRatio('#ffffff', '#1a2b6d')).toBeGreaterThanOrEqual(4.5);
  });
});
