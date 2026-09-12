import { CHART_TYPE_CONFIGS } from '@/app/(dashboard)/dashboards/Properties/PropertiesPanelConfig';

/**
 * Shared chart-type catalogs for chat pivot + dashboard Build switcher.
 *
 * Chat instant-transform supports the interactive set (shape-filtered).
 * Dashboard Build uses the same core order, then extended visuals.
 */

/** Core visuals shared with /chat pivot (same order as listAvailableChartTypes base). */
export const SHARED_CHART_TYPE_ORDER = [
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'scatter',
  'table',
  'stat',
] as const;

/** Dashboard-only visuals (Build switcher; not in chat client-side transform yet). */
export const DASHBOARD_EXTENDED_CHART_TYPES = [
  'heatmap',
  'funnel',
  'gauge',
  'treemap',
  'waterfall',
  'bullet',
  'geo',
] as const;

/** Full Build → chart type switcher list (chat core first, then dashboard extensions). */
export const DASHBOARD_SWITCHABLE_CHART_TYPES = [
  ...SHARED_CHART_TYPE_ORDER,
  ...DASHBOARD_EXTENDED_CHART_TYPES,
] as const;

export type DashboardSwitchableChartType = (typeof DASHBOARD_SWITCHABLE_CHART_TYPES)[number];

/**
 * "Switch to" targets for the dashboard-facing "Change chart type" menus (chat preview tile,
 * Studio Properties panel, Explain-with-AI drawer). This is the core 8 only — every one of the
 * extended 7 (heatmap/funnel/gauge/treemap/waterfall/bullet/geo) falls through, in
 * echartsToSharedWidget.ts's buildFromQueryResult, to the generic single-series x/y builder,
 * which produces the wrong data shape for all of them (a 2D matrix for heatmap, a hierarchy for
 * treemap, region codes for geo, a running-total sequence for waterfall, a value+target pair for
 * bullet) — so offering them as a switch target produces broken or blank charts on real data.
 *
 * The extended 7 stay valid, renderable `chartType` values everywhere else
 * (DASHBOARD_SWITCHABLE_CHART_TYPES, isDashboardSwitchableChartType) for widgets the AI created
 * directly as one of them with a correctly-built payload at creation time — they're excluded
 * only as menu TARGETS. See dashboardChartTypeSwitchTargets() below for how a widget's own
 * current extended type is still represented in its own menu.
 */
export const SAFE_CHART_TYPE_SWITCH_TARGETS = SHARED_CHART_TYPE_ORDER;

export function isSafeChartTypeSwitchTarget(type: string): boolean {
  return (SAFE_CHART_TYPE_SWITCH_TARGETS as readonly string[]).includes(type);
}

/**
 * Builds the type list for a "Change chart type" control on one widget. Always the safe core 8;
 * if the widget's CURRENT type is itself one of the extended 7 (e.g. the AI created it as a
 * correctly-built Geo map), that type is appended so it can still be shown/selected as "current"
 * — a no-op re-select — without offering any OTHER extended type as a target. Without this, an
 * extended-type widget's menu would show no indication of its own current type at all.
 */
export function dashboardChartTypeSwitchTargets(currentType?: string): string[] {
  const current = String(currentType || '').toLowerCase();
  // No current type (or already-safe) → just the safe core 8, nothing appended —
  // guards against dangling an empty-string "type" onto the list.
  if (!current || isSafeChartTypeSwitchTarget(current)) {
    return [...SAFE_CHART_TYPE_SWITCH_TARGETS];
  }
  return [...SAFE_CHART_TYPE_SWITCH_TARGETS, current];
}

/** Chart types available for instant client-side transform in chat / preview. */
export const INTERACTIVE_CHART_TYPES = [
  'bar',
  'line',
  'area',
  'bar_race',
  'line_race',
  'pie',
  'donut',
  'scatter',
  'table',
  'stat',
] as const;

export type InteractiveChartType = (typeof INTERACTIVE_CHART_TYPES)[number];

/** Short labels for icon switchers (Build / chips). */
const SHORT_LABELS: Record<string, string> = {
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  pie: 'Pie',
  donut: 'Donut',
  scatter: 'Scatter',
  table: 'Table',
  stat: 'KPI',
  heatmap: 'Heatmap',
  funnel: 'Funnel',
  gauge: 'Gauge',
  treemap: 'Treemap',
  waterfall: 'Waterfall',
  bullet: 'Bullet',
  geo: 'Geo',
  bar_race: 'Bar race',
  line_race: 'Line race',
};

export function chartTypeShortLabel(type: string): string {
  return SHORT_LABELS[type] ?? chartTypeLabel(type);
}

export function chartTypeLabel(type: string): string {
  if (type === 'table') return 'Table';
  if (type === 'bar_race') return 'Bar race';
  if (type === 'line_race') return 'Line race';
  if (type === 'stat') return CHART_TYPE_CONFIGS.stat?.label ?? 'KPI Card';
  return CHART_TYPE_CONFIGS[type]?.label ?? type.charAt(0).toUpperCase() + type.slice(1);
}

export function isForecastEchartsConfig(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false;
  const series = (config as { series?: Array<{ name?: string; stack?: string }> }).series;
  if (!Array.isArray(series) || series.length < 2) return false;
  const names = series.map((s) => String(s?.name || '').toLowerCase());
  const hasHist = names.some((n) => n.includes('historical'));
  const hasFc = names.some((n) => n === 'forecast' || n.includes('forecast'));
  const hasBand = series.some((s) => {
    const n = String(s?.name || '').toLowerCase();
    return s?.stack === 'confidence-band' || n === 'lower bound' || n.includes('confidence');
  });
  return (hasHist && hasFc) || hasBand;
}

/**
 * True when client-side type switching would destroy a native ECharts option
 * (forecast CI bands, waterfall stacks, animate overlays). Those stay on the
 * native renderer; only Table (raw bound rows) is a safe alternate view.
 */
export function canClientPivotChartConfig(config: unknown): boolean {
  if (!config || typeof config !== 'object') return true;
  if (isForecastEchartsConfig(config)) return false;
  const cfg = config as {
    __animate?: unknown;
    series?: Array<{ markLine?: unknown; stack?: string }>;
  };
  if (cfg.__animate) return false;
  const series = Array.isArray(cfg.series) ? cfg.series : [];
  if (
    series.some(
      (s) =>
        !!s?.markLine ||
        s?.stack === 'waterfall' ||
        s?.stack === 'confidence-band' ||
        s?.stack === 'ci',
    )
  ) {
    return false;
  }
  return true;
}

function hasMeaningfulAreaFill(series: Array<{ type?: string; areaStyle?: unknown }> | undefined): boolean {
  if (!Array.isArray(series)) return false;
  return series.some((s) => {
    if (!s?.areaStyle) return false;
    const area = s.areaStyle as { opacity?: number } | boolean;
    if (area === true) return true;
    if (typeof area === 'object') {
      const opacity = typeof area.opacity === 'number' ? area.opacity : 0.3;
      // Ignore decorative hairline fills (legacy line charts used opacity 0.1).
      return opacity >= 0.2;
    }
    return false;
  });
}

export function inferSeriesChartType(
  config: unknown,
  override: string | null | undefined,
): string {
  if (override) return override.toLowerCase();
  if (!config || typeof config !== 'object') return 'bar';
  const stamped = (config as { aiserChartType?: string }).aiserChartType;
  if (typeof stamped === 'string' && stamped.trim()) {
    return stamped.trim().toLowerCase();
  }
  const cq = (config as { _chart_query?: { chartType?: string } })._chart_query;
  if (typeof cq?.chartType === 'string' && cq.chartType.trim()) {
    return cq.chartType.trim().toLowerCase();
  }
  // Forecast templates use a CI area helper; they are still line charts.
  if (isForecastEchartsConfig(config)) return 'line';
  const series = (config as { series?: Array<{ type?: string; areaStyle?: unknown }> }).series;
  const t = Array.isArray(series) && series[0]?.type ? String(series[0].type).toLowerCase() : 'bar';
  if (t === 'line' && hasMeaningfulAreaFill(series)) {
    return 'area';
  }
  return t;
}

function isNumericCellValue(val: unknown): boolean {
  if (typeof val === 'number' && Number.isFinite(val)) return true;
  if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) return true;
  return false;
}

/**
 * Which chart types make sense for the query result shape (same rules as chat menu).
 * Order matches SHARED_CHART_TYPE_ORDER subset so chat pivot and Build feel aligned.
 */
export function listAvailableChartTypes(
  rows: Array<Record<string, unknown>> | null | undefined,
): InteractiveChartType[] {
  if (!rows?.length) return ['bar', 'line', 'area', 'table'];

  const first = rows[0] ?? {};
  const cols = Object.keys(first);
  const numCols = cols.filter((k) => isNumericCellValue(first[k])).length;
  const strCols = cols.filter((k) => typeof first[k] === 'string' && !isNumericCellValue(first[k])).length;

  const types: InteractiveChartType[] = ['bar', 'line', 'area'];
  if (numCols >= 1 && strCols >= 1) {
    types.push('pie', 'donut');
  }
  if (numCols >= 2) {
    types.push('scatter');
  }
  types.push('table');
  if (rows.length === 1 && numCols >= 1) {
    types.push('stat');
  }
  return types;
}

export function chartTypeSelectOptions(types: readonly string[]): { label: string; value: string }[] {
  return types.map((value) => ({ label: chartTypeLabel(value), value }));
}

export function isInteractiveChartType(type: string): type is InteractiveChartType {
  return (INTERACTIVE_CHART_TYPES as readonly string[]).includes(type);
}

export function isDashboardSwitchableChartType(type: string): type is DashboardSwitchableChartType {
  return (DASHBOARD_SWITCHABLE_CHART_TYPES as readonly string[]).includes(type);
}

/**
 * Chart types for Query Visualize / designer pin — chat shape filter for the shared core,
 * then all dashboard-extended visuals (heatmap…geo) so pin targets match Build switcher.
 */
export function listDashboardVisualizeChartTypes(
  rows: Array<Record<string, unknown>> | null | undefined,
): string[] {
  const core = listAvailableChartTypes(rows);
  const out: string[] = [...core];
  for (const type of DASHBOARD_EXTENDED_CHART_TYPES) {
    if (!out.includes(type)) out.push(type);
  }
  return out;
}
