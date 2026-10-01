import { COLOR_PALETTES } from '../widgets/WidgetRendererConfig';

/** Dashboard + widget chart color presets (shared catalog). UI shows 8 swatches; full set is 20. */
export const CHART_PALETTE_CATALOG = [
  { id: 'default', labelKey: 'palette_default', colors: COLOR_PALETTES.default.slice(0, 8) },
  { id: 'vibrant', labelKey: 'palette_vibrant', colors: COLOR_PALETTES.vibrant.slice(0, 8) },
  { id: 'cool', labelKey: 'palette_cool', colors: COLOR_PALETTES.cool.slice(0, 8) },
  { id: 'warm', labelKey: 'palette_warm', colors: COLOR_PALETTES.warm.slice(0, 8) },
  { id: 'nature', labelKey: 'palette_nature', colors: COLOR_PALETTES.nature.slice(0, 8) },
  { id: 'corporate', labelKey: 'palette_corporate', colors: COLOR_PALETTES.corporate.slice(0, 8) },
  { id: 'pastel', labelKey: 'palette_pastel', colors: COLOR_PALETTES.pastel.slice(0, 8) },
  { id: 'infographic', labelKey: 'palette_infographic', colors: COLOR_PALETTES.infographic.slice(0, 8) },
  { id: 'spectrum', labelKey: 'palette_spectrum', colors: COLOR_PALETTES.spectrum.slice(0, 8) },
  { id: 'colorblindSafe', labelKey: 'palette_colorblind_safe', colors: COLOR_PALETTES.colorblindSafe.slice(0, 8) },
  { id: 'monochrome', labelKey: 'palette_monochrome', colors: COLOR_PALETTES.monochrome.slice(0, 8) },
] as const;

export type ChartPaletteId = (typeof CHART_PALETTE_CATALOG)[number]['id'] | 'custom';

/** Widget uses dashboard default_color_palette (not an explicit chart override). */
export const WIDGET_PALETTE_INHERIT = 'inherit';

export const DEFAULT_CHART_PALETTE_ID: ChartPaletteId = 'default';

export function isKnownChartPalette(id: string | undefined | null): id is ChartPaletteId {
  if (!id || id === 'custom') return id === 'custom';
  return CHART_PALETTE_CATALOG.some((p) => p.id === id);
}

/** True when the widget should follow the dashboard-level palette. */
export function isWidgetPaletteInherited(widgetPalette: string | undefined | null): boolean {
  return !widgetPalette || widgetPalette === WIDGET_PALETTE_INHERIT;
}

export function resolveChartPaletteId(
  widgetPalette: string | undefined | null,
  dashboardPalette: string | undefined | null,
): ChartPaletteId {
  if (widgetPalette === 'custom') return 'custom';
  if (widgetPalette && widgetPalette !== WIDGET_PALETTE_INHERIT && isKnownChartPalette(widgetPalette)) {
    return widgetPalette;
  }
  if (dashboardPalette && isKnownChartPalette(dashboardPalette)) return dashboardPalette;
  return DEFAULT_CHART_PALETTE_ID;
}

/**
 * The catalog palette a list of colours comes from (chat and ECharts configs carry their
 * palette as plain colours), or null when they're genuinely custom. The product's default
 * palette maps to "inherit": it was never a choice, so the chart should follow its dashboard.
 */
export function paletteIdForColors(colors: unknown): ChartPaletteId | typeof WIDGET_PALETTE_INHERIT | null {
  if (!Array.isArray(colors) || colors.length === 0) return null;
  const given = colors.slice(0, 4).map((c) => String(c).trim().toLowerCase());
  for (const palette of CHART_PALETTE_CATALOG) {
    const ref = palette.colors.slice(0, given.length).map((c) => c.toLowerCase());
    if (ref.length === given.length && ref.every((c, i) => c === given[i])) {
      return palette.id === DEFAULT_CHART_PALETTE_ID ? WIDGET_PALETTE_INHERIT : palette.id;
    }
  }
  return null;
}

/** A saved "custom" palette that is really a catalog palette (older chat pins) reads as that. */
export function effectiveWidgetPalette(options: Record<string, unknown> | null | undefined): string | undefined {
  const palette = options?.colorPalette as string | undefined;
  if (palette !== 'custom') return palette;
  return paletteIdForColors(options?.customPalette) ?? palette;
}
