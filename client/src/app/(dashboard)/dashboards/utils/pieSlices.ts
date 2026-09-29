import type { ChartData } from '../widgets/WidgetRendererConfig';

/** Default number of slices a pie shows before the smallest are grouped: top 5 + "Other". */
export const DEFAULT_PIE_MAX_SLICES = 6;

/**
 * A pie reads well with a handful of slices. Past `maxSlices`, keep the largest `maxSlices - 1`
 * and fold the rest into one "Other" slice (marked with `otherIndex` so a click on it doesn't
 * filter the dashboard by a category that doesn't exist). Single-series data only; anything
 * else, or `maxSlices <= 0` ("All"), is returned unchanged.
 */
export function groupSmallSlices(
  data: ChartData,
  maxSlices: number,
  otherLabel: string,
): ChartData & { otherIndex?: number } {
  const labels = Array.isArray(data?.x) ? data.x : [];
  const series = Array.isArray(data?.series) ? data.series : [];
  if (maxSlices <= 0 || labels.length <= maxSlices || series.length > 1) return data;
  const values: number[] = (data.y?.length ? data.y : series[0]?.data ?? []).map((v: unknown) =>
    typeof v === 'number' ? v : Number(v) || 0,
  );
  const order = labels.map((_, i) => i).sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0));
  const keep = order.slice(0, maxSlices - 1);
  const rest = order.slice(maxSlices - 1);
  const x = [...keep.map((i) => labels[i]), otherLabel];
  const y = [...keep.map((i) => values[i] ?? 0), rest.reduce((sum, i) => sum + (values[i] ?? 0), 0)];
  return {
    ...data,
    x,
    y,
    series: series.length ? [{ ...series[0], data: y }] : series,
    otherIndex: x.length - 1,
  };
}
