/**
 * WCAG contrast helpers shared by the theme providers (CE ThemeProvider and the EE brand theme),
 * so both resolve the same readable primary colour from a brand colour.
 */

export function hexToRgb(bgHex: string): [number, number, number] | null {
    const hex = bgHex.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function rgbToHex(r: number, g: number, b: number): string {
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG relative luminance for 0-255 channel values. */
export function relativeLuminance(r: number, g: number, b: number): number {
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [rl, gl, bl] = [r, g, b].map((v) => lin(v / 255));
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG contrast ratio between two relative luminances. */
export function contrastRatio(l1: number, l2: number): number {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG contrast ratio between two #rrggbb colours (null when either can't be parsed). */
export function hexContrast(a: string, b: string): number | null {
    const ra = hexToRgb(a);
    const rb = hexToRgb(b);
    if (!ra || !rb) return null;
    return contrastRatio(relativeLuminance(...ra), relativeLuminance(...rb));
}

/**
 * Picks whichever of the two candidates has the higher contrast against the actual resolved
 * background, so it adapts to brand overrides instead of assuming teal.
 */
export function pickReadableTextColor(bgHex: string, darkText: string, lightText: string): string {
    const rgb = hexToRgb(bgHex);
    if (!rgb) return lightText;
    const bgLuminance = relativeLuminance(...rgb);
    return contrastRatio(bgLuminance, 0) >= contrastRatio(bgLuminance, 1) ? darkText : lightText;
}

/**
 * Darkens bgHex just enough that fixed white text reaches targetRatio against it, scaling all
 * three channels toward black together so hue and saturation are preserved. Returns bgHex
 * unchanged when white already passes.
 */
export function darkenForWhiteText(bgHex: string, targetRatio = 4.6): string {
    const rgb = hexToRgb(bgHex);
    if (!rgb) return bgHex;
    const [r, g, b] = rgb;
    if (contrastRatio(relativeLuminance(r, g, b), 1) >= targetRatio) {
        return bgHex;
    }
    // Binary search the largest scale factor t in [0, 1] (t=1 is the original colour, t=0 is
    // black) for which contrast still passes - the least darkening that meets the target.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (contrastRatio(relativeLuminance(r * mid, g * mid, b * mid), 1) >= targetRatio) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return rgbToHex(r * lo, g * lo, b * lo);
}

/** The colour with all three channels scaled toward black by factor (1 = unchanged). */
export function shade(hex: string, factor: number): string {
    const rgb = hexToRgb(hex);
    return rgb ? rgbToHex(rgb[0] * factor, rgb[1] * factor, rgb[2] * factor) : hex;
}

/** The colour laid over white at the given opacity, as a solid colour (a light tint). */
export function tint(hex: string, amount: number): string {
    const rgb = hexToRgb(hex);
    return rgb ? rgbToHex(...(rgb.map((c) => 255 + (c - 255) * amount) as [number, number, number])) : hex;
}

/**
 * Light fills and edges around the primary (selected rows, icon badges, info-style fills), made
 * from the vivid brand colour. antd would derive them from the darkened primary, which comes out
 * grey; dark mode's algorithm derives its own and needs none of this.
 */
export type PrimaryTints = { bg: string; bgHover: string; border: string; borderHover: string };

export type PrimaryShades = { base: string; hover: string; active: string; text: string; tints?: PrimaryTints };

/**
 * The primary colour as the interface uses it: filled buttons with a label on them, links,
 * selected tabs. In light mode a bright brand colour (the default teal is ~2.2:1 on white) is
 * darkened, keeping its hue, until white labels on it and it as text on the grey page canvas
 * both reach WCAG AA (5.1:1 against white is ~4.5:1 against the canvas). Hover and pressed
 * states go a step darker. Dark mode keeps the brand colour, which already reads on dark
 * surfaces. The logo and brand marks keep the raw brand colour; this is only for UI.
 */
export function accessiblePrimary(
    brand: string,
    isDarkMode: boolean,
    brandHover?: string,
    brandActive?: string,
): PrimaryShades {
    if (isDarkMode) {
        return {
            base: brand,
            hover: brandHover || brand,
            active: brandActive || brand,
            text: pickReadableTextColor(brand, '#0d1117', '#ffffff'),
        };
    }
    const base = darkenForWhiteText(brand, 5.1);
    return {
        base,
        hover: shade(base, 0.88),
        active: shade(base, 0.77),
        text: pickReadableTextColor(base, '#0d1117', '#ffffff'),
        tints: { bg: tint(brand, 0.1), bgHover: tint(brand, 0.18), border: tint(brand, 0.4), borderHover: tint(brand, 0.6) },
    };
}

/** antd tokens for the light tints (empty in dark mode, where the algorithm's own work well). */
export function primaryTintTokens(shades: PrimaryShades): Record<string, string> {
    const t = shades.tints;
    return t
        ? { colorPrimaryBg: t.bg, colorPrimaryBgHover: t.bgHover, colorPrimaryBorder: t.border, colorPrimaryBorderHover: t.borderHover }
        : {};
}

/**
 * Light-mode fills and edges for status colours (tags, alerts), tinted from each colour the way
 * primaryTintTokens does; antd's own derivation greys out deeper colours such as #16a34a.
 */
export function statusTintTokens(
    isDarkMode: boolean,
    colors: { success: string; warning: string; error: string; info: string },
): Record<string, string> {
    if (isDarkMode) return {};
    const out: Record<string, string> = {};
    for (const [name, hex] of Object.entries(colors)) {
        const key = name[0].toUpperCase() + name.slice(1);
        out[`color${key}Bg`] = tint(hex, 0.1);
        out[`color${key}BgHover`] = tint(hex, 0.18);
        out[`color${key}Border`] = tint(hex, 0.4);
        out[`color${key}BorderHover`] = tint(hex, 0.6);
        // Hover and pressed go darker, so status text (e.g. a "Delete" link) stays readable.
        out[`color${key}Hover`] = shade(hex, 0.85);
        out[`color${key}Active`] = shade(hex, 0.72);
    }
    return out;
}

/**
 * Link colours from the primary. antd otherwise derives links from the info colour, which gave a
 * pale cyan hover in light mode (2.3:1) and a dark blue one in dark mode (1.9:1). Hover goes a
 * step darker in light mode and a step lighter in dark mode, so it stays readable in both.
 */
export function primaryLinkTokens(shades: PrimaryShades, isDarkMode: boolean): Record<string, string> {
    return isDarkMode
        ? { colorLink: shades.base, colorLinkHover: tint(shades.base, 0.75), colorLinkActive: shades.base }
        : { colorLink: shades.base, colorLinkHover: shades.hover, colorLinkActive: shades.active };
}
