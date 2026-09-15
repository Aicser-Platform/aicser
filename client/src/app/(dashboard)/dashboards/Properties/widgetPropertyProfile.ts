import { DASHBOARD_SWITCHABLE_CHART_TYPES } from '@/components/charts/chartTypeCatalog';

/**
 * Adaptive properties profile per widget / chart type.
 * Used by PropertiesPanel, ChartOptions, and ChartSpecificFields so Format/Build
 * only surface controls that the renderer actually honors.
 */

export type WidgetPropertyKind =
  | 'cartesian'
  | 'pie'
  | 'table'
  | 'kpi'
  | 'gauge'
  | 'funnel'
  | 'treemap'
  | 'heatmap'
  | 'waterfall'
  | 'bullet'
  | 'map'
  | 'content'
  | 'control';

export type WidgetPropertyProfile = {
  kind: WidgetPropertyKind;
  /** Shown in Build → chart type switcher (data visuals only). */
  inChartTypeSwitcher: boolean;
  /** Format → legend checkbox */
  showLegendToggle: boolean;
  /** Format → data label checkbox */
  showDataLabelToggle: boolean;
  /** Format → gridline + X/Y axis checkboxes */
  showCartesianAxes: boolean;
  /** Format → color palette section */
  showColorPalette: boolean;
  /** Format → legend series sort / max series */
  showLegendSeriesControls: boolean;
  /** Format → generic value format select (not type-specific format) */
  showValueFormat: boolean;
  /** Format → trend / average / reference overlays */
  showOverlays: boolean;
  /** Sort tab → sort-by / row-limit controls. False for single-value widgets
   *  (stat, gauge) that have no rows to sort or cap — those controls rendered
   *  unconditionally before and did nothing when changed. */
  showSortControls: boolean;
  /** Format → design templates, log axes, mark lines, ranked labels */
  showDesign: boolean;
};

const CONTENT: WidgetPropertyProfile = {
  kind: 'content',
  inChartTypeSwitcher: false,
  showLegendToggle: false,
  showDataLabelToggle: false,
  showCartesianAxes: false,
  showColorPalette: false,
  showLegendSeriesControls: false,
  showValueFormat: false,
  showOverlays: false,
  showSortControls: false,
  showDesign: false,
};

const CONTROL: WidgetPropertyProfile = {
  kind: 'control',
  inChartTypeSwitcher: false,
  showLegendToggle: false,
  showDataLabelToggle: false,
  showCartesianAxes: false,
  showColorPalette: false,
  showLegendSeriesControls: false,
  showValueFormat: false,
  showOverlays: false,
  showSortControls: false,
  showDesign: false,
};

const CARTESIAN: WidgetPropertyProfile = {
  kind: 'cartesian',
  inChartTypeSwitcher: true,
  showLegendToggle: true,
  showDataLabelToggle: true,
  showCartesianAxes: true,
  showColorPalette: true,
  showLegendSeriesControls: true,
  showValueFormat: true,
  showOverlays: true,
  showSortControls: true,
  showDesign: true,
};

export const WIDGET_PROPERTY_PROFILES: Record<string, WidgetPropertyProfile> = {
  bar: CARTESIAN,
  line: CARTESIAN,
  area: { ...CARTESIAN, kind: 'cartesian' },
  scatter: CARTESIAN,
  pie: {
    kind: 'pie',
    inChartTypeSwitcher: true,
    showLegendToggle: true,
    showDataLabelToggle: true,
    showCartesianAxes: false,
    showColorPalette: true,
    showLegendSeriesControls: true,
    showValueFormat: false,
    showOverlays: false,
    showSortControls: true,
    showDesign: false,
  },
  donut: {
    kind: 'pie',
    inChartTypeSwitcher: true,
    showLegendToggle: true,
    showDataLabelToggle: true,
    showCartesianAxes: false,
    showColorPalette: true,
    showLegendSeriesControls: true,
    showValueFormat: false,
    showOverlays: false,
    showSortControls: true,
    showDesign: false,
  },
  table: {
    kind: 'table',
    inChartTypeSwitcher: true,
    showLegendToggle: false,
    showDataLabelToggle: false,
    showCartesianAxes: false,
    showColorPalette: false,
    showLegendSeriesControls: false,
    showValueFormat: false,
    showOverlays: false,
    showSortControls: true,
    showDesign: false,
  },
  stat: {
    kind: 'kpi',
    inChartTypeSwitcher: true,
    showLegendToggle: false,
    showDataLabelToggle: false,
    showCartesianAxes: false,
    showColorPalette: true,
    showLegendSeriesControls: false,
    showValueFormat: false,
    showOverlays: false,
    // A stat tile is one aggregate value — no rows to sort or cap.
    showSortControls: false,
    showDesign: false,
  },
  heatmap: {
    kind: 'heatmap',
    inChartTypeSwitcher: true,
    showLegendToggle: false,
    showDataLabelToggle: true,
    showCartesianAxes: true,
    showColorPalette: false, // uses dedicated colorFrom / colorTo
    showLegendSeriesControls: false,
    showValueFormat: true,
    showOverlays: false,
    showSortControls: true,
    showDesign: false,
  },
  funnel: {
    kind: 'funnel',
    inChartTypeSwitcher: true,
    showLegendToggle: true,
    showDataLabelToggle: true,
    showCartesianAxes: false,
    showColorPalette: true,
    showLegendSeriesControls: true,
    showValueFormat: true,
    showOverlays: false,
    showSortControls: true,
    showDesign: false,
  },
  gauge: {
    kind: 'gauge',
    inChartTypeSwitcher: true,
    showLegendToggle: false,
    showDataLabelToggle: false,
    showCartesianAxes: false,
    showColorPalette: true,
    showLegendSeriesControls: false,
    showValueFormat: false,
    showOverlays: false,
    // Same as stat — a single needle/value, nothing to sort or cap.
    showSortControls: false,
    showDesign: false,
  },
  treemap: {
    kind: 'treemap',
    inChartTypeSwitcher: true,
    showLegendToggle: false,
    showDataLabelToggle: true,
    showCartesianAxes: false,
    showColorPalette: true,
    showLegendSeriesControls: false,
    showValueFormat: true,
    showOverlays: false,
    showSortControls: true,
    showDesign: false,
  },
  waterfall: {
    kind: 'waterfall',
    inChartTypeSwitcher: true,
    showLegendToggle: true,
    showDataLabelToggle: true,
    showCartesianAxes: true,
    showColorPalette: true,
    showLegendSeriesControls: false,
    showValueFormat: true,
    showOverlays: false,
    showSortControls: true,
    showDesign: true,
  },
  bullet: {
    kind: 'bullet',
    inChartTypeSwitcher: true,
    showLegendToggle: false,
    showDataLabelToggle: true,
    showCartesianAxes: true,
    showColorPalette: true,
    showLegendSeriesControls: false,
    showValueFormat: true,
    showOverlays: false,
    showSortControls: true,
    showDesign: true,
  },
  geo: {
    kind: 'map',
    inChartTypeSwitcher: true,
    showLegendToggle: false,
    showDataLabelToggle: false,
    showCartesianAxes: false,
    showColorPalette: false, // dedicated colorFrom / colorTo
    showLegendSeriesControls: false,
    showValueFormat: false,
    showOverlays: false,
    showSortControls: true,
    showDesign: false,
  },
  text: CONTENT,
  image: CONTENT,
  embed: CONTENT,
  divider: CONTENT,
  slicer: CONTROL,
  filter: CONTROL,
};

const FALLBACK: WidgetPropertyProfile = {
  kind: 'cartesian',
  inChartTypeSwitcher: false,
  showLegendToggle: true,
  showDataLabelToggle: true,
  showCartesianAxes: true,
  showColorPalette: true,
  showLegendSeriesControls: true,
  showValueFormat: true,
  showOverlays: false,
  showSortControls: true,
  showDesign: true,
};

export function getWidgetPropertyProfile(chartType?: string): WidgetPropertyProfile {
  if (!chartType) return FALLBACK;
  return WIDGET_PROPERTY_PROFILES[chartType] || FALLBACK;
}

export function isContentWidgetType(chartType?: string): boolean {
  return getWidgetPropertyProfile(chartType).kind === 'content';
}

export function isControlWidgetType(chartType?: string): boolean {
  return getWidgetPropertyProfile(chartType).kind === 'control';
}

/** Data visuals that appear in the Build chart-type switcher (chat core order + extensions). */
export const SWITCHABLE_CHART_TYPES: string[] = [...DASHBOARD_SWITCHABLE_CHART_TYPES];
