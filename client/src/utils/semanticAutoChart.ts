/** Auto chart selection for the Semantic Workbook: dumb, predictable rules. */

export type SemanticChartKind = 'line' | 'bar' | 'area' | 'pie' | 'scatter' | 'stat';

const PALETTE = ['#4f6bed', '#13a8a8', '#f59e0b', '#7c3aed', '#ef4444', '#2f855a'];

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

export function pickChartKind(
  metrics: string[],
  dimensions: string[],
  hasTimeGrain: boolean
): SemanticChartKind {
  if (metrics.length === 1 && dimensions.length === 0) return 'stat';
  if (hasTimeGrain) return 'line';
  return 'bar';
}

export function buildChartOption(
  rows: Array<Record<string, unknown>>,
  metrics: string[],
  dimensions: string[],
  kind: Exclude<SemanticChartKind, 'stat'>,
  labels?: Record<string, string>
): Record<string, unknown> {
  const label = (m: string) => labels?.[m] || m;
  const metricComparison = dimensions.length === 0;
  if (kind === 'pie') {
    if (metricComparison) {
      const first = rows[0] || {};
      return {
        color: PALETTE,
        tooltip: { trigger: 'item' },
        legend: { top: 0, type: 'scroll' },
        series: [{
          name: 'Metrics',
          type: 'pie',
          radius: ['42%', '70%'],
          center: ['50%', '56%'],
          data: metrics.map((m) => ({ name: label(m), value: toNumber(first[m]) })),
          label: { formatter: '{b}: {c}' },
        }],
      };
    }
    const xField = dimensions[0];
    const metric = metrics[0];
    return {
      color: PALETTE,
      tooltip: { trigger: 'item' },
      legend: { top: 0, type: 'scroll' },
      series: [{
        name: label(metric),
        type: 'pie',
        radius: ['42%', '70%'],
        center: ['50%', '56%'],
        data: rows.map((r) => ({ name: String(r[xField] ?? '—'), value: toNumber(r[metric]) })),
        label: { formatter: '{b}: {c}' },
      }],
    };
  }

  if (metricComparison) {
    const first = rows[0] || {};
    const categories = metrics.map(label);
    return {
      color: PALETTE,
      tooltip: { trigger: 'axis' },
      legend: undefined,
      grid: { left: 56, right: 24, top: 28, bottom: 56, containLabel: true },
      xAxis: { type: 'category', data: categories, axisLabel: { rotate: categories.some((c) => c.length > 14) ? 30 : 0 } },
      yAxis: { type: 'value' },
      series: [{
        name: 'Value',
        type: kind === 'scatter' ? 'scatter' : kind === 'area' ? 'line' : kind,
        areaStyle: kind === 'area' ? {} : undefined,
        smooth: kind === 'line' || kind === 'area',
        symbolSize: kind === 'scatter' ? 12 : undefined,
        data: metrics.map((m) => toNumber(first[m])),
      }],
    };
  }

  const xField = dimensions[0];
  const xData = rows.map((r) => String(r[xField] ?? ''));
  return {
    color: PALETTE,
    tooltip: { trigger: 'axis' },
    legend: metrics.length > 1 ? { top: 0, type: 'scroll' } : undefined,
    grid: { left: 56, right: 24, top: metrics.length > 1 ? 44 : 28, bottom: 48, containLabel: true },
    xAxis: { type: 'category', data: xData },
    yAxis: { type: 'value' },
    series: metrics.map((m) => ({
      name: label(m),
      type: kind === 'scatter' ? 'scatter' : kind === 'area' ? 'line' : kind,
      areaStyle: kind === 'area' ? {} : undefined,
      smooth: kind === 'line' || kind === 'area',
      symbolSize: kind === 'scatter' ? 10 : undefined,
      data: rows.map((r) => toNumber(r[m])),
    })),
  };
}
