import type { WidgetInstance } from '../stores/dashboardStoreTypes';
import { CHART_TYPE_CONFIGS } from '../Properties/PropertiesPanelConfig';

const SINGLE_METRIC_TYPES = new Set([
  'stat',
  'gauge',
  'funnel',
  'treemap',
  'waterfall',
  'bullet',
  'geo',
  'heatmap',
]);

function metricListMaxCount(chartType: string, fieldKey: string): number | undefined {
  const fields = CHART_TYPE_CONFIGS[chartType]?.fields || [];
  const field = fields.find((f) => f.key === fieldKey);
  return field?.maxCount;
}

/**
 * When changing chart type, preserve chartQuery fields when types are compatible,
 * and enforce industry maxCounts / legend↔multi-Y XOR for the destination type.
 */
export function preserveChartQueryOnTypeChange(
  widget: WidgetInstance,
  nextType: string,
): Record<string, unknown> {
  const prevType = widget.chartType;
  const q: Record<string, unknown> = { ...(widget.chartQuery || {}) };
  if (prevType === nextType) return q;

  // Drop secondary axis when leaving bar/line/area (and combo)
  if (!['bar', 'line', 'area', 'bullet'].includes(nextType)) {
    q.yMetricsSecondary = [];
  }

  // Entering scatter: seed xMetrics from x if needed
  if (nextType === 'scatter' && prevType !== 'scatter') {
    if (!Array.isArray(q.xMetrics) || !(q.xMetrics as unknown[]).length) {
      if (q.x) {
        q.xMetrics = [{ field: q.x, aggregation: 'none' }];
      }
    }
  }

  const yMax =
    metricListMaxCount(nextType, 'yMetrics') ??
    (SINGLE_METRIC_TYPES.has(nextType) ? 1 : undefined);
  if (yMax != null && Array.isArray(q.yMetrics) && (q.yMetrics as unknown[]).length > yMax) {
    q.yMetrics = (q.yMetrics as unknown[]).slice(0, yMax);
  }

  const secMax = metricListMaxCount(nextType, 'yMetricsSecondary');
  if (
    secMax != null &&
    Array.isArray(q.yMetricsSecondary) &&
    (q.yMetricsSecondary as unknown[]).length > secMax
  ) {
    q.yMetricsSecondary = (q.yMetricsSecondary as unknown[]).slice(0, secMax);
  }

  // Legend / multi-Y XOR (pivot path only supports one measure with break-by)
  const yLen = Array.isArray(q.yMetrics) ? (q.yMetrics as unknown[]).length : 0;
  if (yLen > 1 && (q.groupField || q.legend)) {
    delete q.groupField;
    delete q.legend;
    delete q.group;
  }

  return q;
}

/**
 * Normalize display options when switching chart type (matches chat rebuild defaults).
 */
export function normalizeChartOptionsOnTypeChange(
  nextType: string,
  prevOptions: Record<string, unknown> = {},
): Record<string, unknown> {
  const next = { ...prevOptions };

  if (nextType === 'donut') {
    const hole = Number(next.innerRadius);
    if (!Number.isFinite(hole) || hole <= 0) next.innerRadius = 40;
  } else if (nextType === 'pie') {
    next.innerRadius = 0;
  }

  if (nextType === 'stat' || nextType === 'gauge') {
    next.showLegend = false;
  }

  if (nextType === 'geo' || nextType === 'heatmap') {
    if (!next.colorFrom) next.colorFrom = nextType === 'geo' ? '#b7e4f9' : '#e0f3f8';
    if (!next.colorTo) next.colorTo = nextType === 'geo' ? '#004a80' : '#004a4d';
  }

  return next;
}
