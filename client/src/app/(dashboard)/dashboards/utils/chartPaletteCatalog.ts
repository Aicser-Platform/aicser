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
