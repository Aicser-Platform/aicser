import type { ChartData } from '../services/chartService';
import type { WidgetInstance } from '../stores/useDashboardStore';

/**
 * When backend returns long-format rows (x + group_field + metric columns),
 * pivot into wide series Power BI / Tableau style: one series per legend value.
 */
export function pivotGroupedChartData(data: ChartData): ChartData {
  const groups = data.group_field;
  const xs = data.x;
  if (!Array.isArray(groups) || !Array.isArray(xs) || groups.length === 0 || groups.length !== xs.length) {
    return data;
  }

  // Unique category order (first-seen) and group order (first-seen).
  const categories: string[] = [];
  const catIndex = new Map<string, number>();
  for (const raw of xs) {
    const key = String(raw ?? '');
    if (!catIndex.has(key)) {
      catIndex.set(key, categories.length);
      categories.push(key);
    }
  }

  const groupNames: string[] = [];
  const groupIndex = new Map<string, number>();
  for (const raw of groups) {
    const key = String(raw ?? 'Unknown');
    if (!groupIndex.has(key)) {
      groupIndex.set(key, groupNames.length);
      groupNames.push(key);
    }
  }

  // Prefer the first primary metric column when pivoting by legend.
  const sourceSeries = data.series?.[0];
  const values = sourceSeries?.data;
  if (!Array.isArray(values) || values.length !== xs.length) {
    return data;
  }

  const matrix: Array<Array<number | null>> = groupNames.map(() =>
    categories.map(() => null),
  );

  for (let i = 0; i < xs.length; i += 1) {
    const ci = catIndex.get(String(xs[i] ?? ''));
    const gi = groupIndex.get(String(groups[i] ?? 'Unknown'));
    if (ci == null || gi == null) continue;
    const raw = values[i];
    const num = typeof raw === 'number' ? raw : Number(raw);
    matrix[gi]![ci] = Number.isFinite(num) ? num : null;
  }

  const series = groupNames.map((name, gi) => ({
    name,
    data: matrix[gi]!.map((v) => (v == null ? 0 : v)),
  }));

  return {
    ...data,
    x: categories,
    y: series[0]?.data,
    series,
    // group_field consumed — avoid double-handling in heatmap/scatter paths
    group_field: undefined,
  };
}

/** Split combined series payload into primary / secondary axes when needed. */
export function partitionSeriesData(
  data: ChartData,
  widget: Pick<WidgetInstance, 'chartType' | 'chartQuery'>,
): ChartData {
  const cartesianTypes = ['line', 'bar', 'area'];
  const next = data;

  const hasGroupField =
    Array.isArray(data.group_field) && data.group_field.length > 0;

  // Legend / break-by dimension: pivot long rows into series for cartesian charts.
  // After a legend pivot, series are category breaks — do NOT re-split as secondary axis.
  if (cartesianTypes.includes(widget.chartType) && hasGroupField) {
    return pivotGroupedChartData(data);
  }

  if (next.secondarySeries && next.secondarySeries.length > 0) return next;
  if (!cartesianTypes.includes(widget.chartType) || !next.series || next.series.length === 0) {
    return next;
  }

  const yMetricsCount = widget.chartQuery?.yMetrics?.length || 0;
  const secondaryMetricsCount = widget.chartQuery?.yMetricsSecondary?.length || 0;

  if (secondaryMetricsCount === 0) return next;

  const series = next.series.slice(0, Math.max(1, yMetricsCount));
  const secondarySeries = next.series.slice(
    Math.max(1, yMetricsCount),
    Math.max(1, yMetricsCount) + secondaryMetricsCount,
  );

  return { ...next, series, secondarySeries };
}
