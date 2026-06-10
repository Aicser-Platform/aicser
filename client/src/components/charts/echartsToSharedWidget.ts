import type { ChartData } from '@/app/(dashboard)/dashboards/widgets/WidgetRendererConfig';
import { hydrateChartConfigFromQueryResult, rawChartConfig } from '@/components/charts/hydrateChartConfig';
import { columnHeaderFromKey } from '@/utils/columnLabels';

export type SharedChartProps = {
  chartType: string;
  chartData: ChartData;
  chartOptions: Record<string, unknown>;
  chartQuery: Record<string, unknown>;
};

const SUPPORTED = new Set(['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'funnel', 'heatmap']);

const CHART_ANIMATION_DEFAULTS = {
  animation: true,
  animationDuration: 800,
  animationEasing: 'cubicOut',
} as const;

function tagChatSource(props: SharedChartProps): SharedChartProps {
  return {
    ...props,
    chartOptions: { ...props.chartOptions, __source: 'ai_chat' },
  };
}

function rawConfig(config: unknown): Record<string, unknown> {
  return rawChartConfig(config);
}

function inferChartType(cfg: Record<string, unknown>): string | null {
  const series = cfg.series as Array<Record<string, unknown>> | undefined;
  const first = series?.[0];
  if (!first?.type) return null;
  let chartType = String(first.type);
  if (chartType === 'line' && series?.some((s) => s.areaStyle)) chartType = 'area';
  if (chartType === 'pie') {
    const radius = first.radius;
    if (Array.isArray(radius) && parseFloat(String(radius[0])) > 0) chartType = 'donut';
  }
  if (chartType === 'heatmap') return 'heatmap';
  if (cfg.visualMap && chartType === 'scatter') return 'heatmap';
  return SUPPORTED.has(chartType) ? chartType : null;
}

function isComplexEcharts(cfg: Record<string, unknown>): boolean {
  const graphic = cfg.graphic;
  if (!graphic) return false;
  // Only skip shared path for animation overlay graphics, not static heatmap labels.
  if (cfg.__animate || (cfg as { animation?: boolean }).animation === false) return true;
  return Array.isArray(graphic) && graphic.some((g) => {
    if (!g || typeof g !== 'object') return false;
    return (g as { type?: string }).type === 'group' && !!(g as { children?: unknown[] }).children?.length;
  });
}

function isNumericCellValue(val: unknown): boolean {
  if (typeof val === 'number' && Number.isFinite(val)) return true;
  if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) return true;
  return false;
}

function inferNumericColumns(rows: Record<string, unknown>[]): string[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  return keys.filter((k) => rows.some((r) => isNumericCellValue(r[k])));
}

function inferLabelColumn(rows: Record<string, unknown>[], exclude: string[]): string | null {
  const keys = Object.keys(rows[0] || {});
  const dateKey = keys.find(
    (k) =>
      !exclude.includes(k) &&
      typeof rows[0][k] === 'string' &&
      /^\d{4}-\d{2}/.test(String(rows[0][k])),
  );
  if (dateKey) return dateKey;
  return keys.find((k) => !exclude.includes(k) && typeof rows[0][k] === 'string') || null;
}

function buildScatterFromQueryResult(
  rows: Record<string, unknown>[],
  message?: unknown,
): SharedChartProps | null {
  const numerics = inferNumericColumns(rows);
  if (!numerics.length) return null;

  const meta =
    (message as { executionMetadata?: { chart_query?: Record<string, unknown> } })?.executionMetadata
      ?.chart_query ||
    (message as { ai_metadata?: { chart_query?: Record<string, unknown> } })?.ai_metadata?.chart_query ||
    {};

  let xKey = String(meta.scatterX || meta.xMetric || meta.x || '');
  let yKey = String(meta.yMetric || meta.yField || meta.metric || '');

  if (!xKey || !numerics.includes(xKey)) xKey = numerics[0];
  if (!yKey || !numerics.includes(yKey) || yKey === xKey) {
    yKey = numerics.find((k) => k !== xKey) || numerics[0];
  }

  const labelKey = inferLabelColumn(rows, [xKey, yKey]);
  const labels = labelKey
    ? rows.map((r) => String(r[labelKey] ?? ''))
    : rows.map((_, i) => String(i + 1));

  const pointData = rows.map((r) => {
    const x = Number(r[xKey]);
    const y = Number(r[yKey]);
    return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0] as [number, number];
  });

  const formatLabel = columnHeaderFromKey;

  return {
    chartType: 'scatter',
    chartData: {
      x: labels,
      y: pointData.map((p) => p[1]),
      series: [{ name: `${formatLabel(yKey)} vs ${formatLabel(xKey)}`, data: pointData }],
    },
    chartOptions: {
      xAxisLabel: formatLabel(xKey),
      yAxisLabel: formatLabel(yKey),
    },
    chartQuery: { x: xKey, yMetric: yKey, scatterX: xKey, aggregate: meta.aggregate || 'sum' },
  };
}

function buildFromQueryResult(
  rows: Record<string, unknown>[],
  chartType: string,
  message?: unknown
): SharedChartProps | null {
  if (!rows.length) return null;
  if (chartType === 'scatter') {
    return buildScatterFromQueryResult(rows, message);
  }
  const keys = Object.keys(rows[0]);
  const meta =
    (message as { executionMetadata?: { chart_query?: Record<string, unknown> } })?.executionMetadata
      ?.chart_query ||
    (message as { ai_metadata?: { chart_query?: Record<string, unknown> } })?.ai_metadata?.chart_query ||
    {};

  let xKey = String(meta.x || meta.xField || meta.x_axis || '');
  let yKey = String(meta.yMetric || meta.yField || meta.metric || '');

  if (!xKey || !keys.includes(xKey)) {
    xKey =
      keys.find((k) => typeof rows[0][k] === 'string') ||
      keys.find((k) => !/^(id|_id)$/i.test(k)) ||
      keys[0];
  }
  if (!yKey || !keys.includes(yKey)) {
    yKey =
      keys.find((k) => k !== xKey && typeof rows[0][k] === 'number') ||
      keys.find((k) => k !== xKey && !Number.isNaN(Number(rows[0][k]))) ||
      keys[1];
  }
  if (!xKey || !yKey) return null;

  const x = rows.map((r) => String(r[xKey] ?? ''));
  const data = rows.map((r) => Number(r[yKey]) || 0);

  return {
    chartType,
    chartData: {
      x,
      y: data,
      series: [{ name: String(yKey), data }],
    },
    chartOptions: {},
    chartQuery: { x: xKey, yMetric: yKey, aggregate: meta.aggregate || 'sum' },
  };
}

function buildScatterFromEchartsConfig(cfg: Record<string, unknown>): SharedChartProps | null {
  const series = (cfg.series as Array<Record<string, unknown>>) || [];
  const scatterSeries = series.filter((s) => String(s.type || '') === 'scatter');
  if (!scatterSeries.length) return null;

  const xAxis = Array.isArray(cfg.xAxis) ? (cfg.xAxis[0] as Record<string, unknown>) : (cfg.xAxis as Record<string, unknown>);
  const xLabels = ((xAxis?.data as unknown[]) || []).map((v) => String(v ?? ''));

  const mappedSeries = scatterSeries.map((s, i) => {
    const raw = (s.data as unknown[]) || [];
    const data = raw.map((d, idx) => {
      if (Array.isArray(d) && d.length >= 2) {
        const x = Number(d[0]);
        const y = Number(d[1]);
        return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0] as [number, number];
      }
      const y = typeof d === 'number' ? d : Number(d) || 0;
      const xVal = xLabels[idx];
      const x = typeof xVal === 'number' ? xVal : parseFloat(String(xVal));
      return [Number.isFinite(x) ? x : idx, y] as [number, number];
    });
    return { name: String(s.name || `Series ${i + 1}`), data };
  });

  if (!mappedSeries.length || !mappedSeries[0]?.data?.length) return null;

  return {
    chartType: 'scatter',
    chartData: {
      x: xLabels.length ? xLabels : mappedSeries[0].data.map((_, idx) => String(idx + 1)),
      y: mappedSeries[0].data.map((p) => (Array.isArray(p) ? p[1] : 0)),
      series: mappedSeries,
    },
    chartOptions: { ...CHART_ANIMATION_DEFAULTS, animation: cfg.animation ?? true },
    chartQuery: {},
  };
}

function buildHeatmapFromEcharts(cfg: Record<string, unknown>): SharedChartProps | null {
  const series = (cfg.series as Array<Record<string, unknown>>) || [];
  const hm = series.find((s) => s.type === 'heatmap') || series[0];
  if (!hm) return null;
  const raw = (hm.data as unknown[]) || [];
  const xAxis = Array.isArray(cfg.xAxis) ? (cfg.xAxis[0] as Record<string, unknown>) : (cfg.xAxis as Record<string, unknown>);
  const yAxis = Array.isArray(cfg.yAxis) ? (cfg.yAxis[0] as Record<string, unknown>) : (cfg.yAxis as Record<string, unknown>);
  const xLabels = ((xAxis?.data as unknown[]) || []).map(String);
  const yLabels = ((yAxis?.data as unknown[]) || []).map(String);
  const matrix: number[][] = [];
  for (const cell of raw) {
    if (Array.isArray(cell) && cell.length >= 3) {
      const xi = Number(cell[0]);
      const yi = Number(cell[1]);
      const val = Number(cell[2]) || 0;
      if (!matrix[yi]) matrix[yi] = [];
      matrix[yi][xi] = val;
    }
  }
  const flat = matrix.flatMap((row, yi) =>
    row.map((val, xi) => [xLabels[xi] || String(xi), yLabels[yi] || String(yi), val] as [string, string, number])
  );
  return {
    chartType: 'heatmap',
    chartData: {
      x: xLabels,
      y: yLabels,
      series: [{ name: 'Heatmap', data: flat.map(([, , v]) => v) }],
      heatmap: flat,
    },
    chartOptions: { visualMap: cfg.visualMap, ...CHART_ANIMATION_DEFAULTS, animation: cfg.animation ?? true },
    chartQuery: {},
  };
}

function encodeDimensionName(encode: Record<string, unknown> | undefined, key: 'x' | 'y'): string | null {
  if (!encode) return null;
  const raw = encode[key];
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    if (typeof first === 'string' && first.trim()) return first;
    if (typeof first === 'number' && Number.isFinite(first)) return String(first);
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

function buildFromDatasetEncode(cfg: Record<string, unknown>, chartType: string): SharedChartProps | null {
  const ds = cfg.dataset as Record<string, unknown> | undefined;
  const rows = ds?.source as Record<string, unknown>[] | undefined;
  if (!rows?.length) return null;

  if (chartType === 'scatter') {
    return buildScatterFromQueryResult(rows);
  }

  const series = (cfg.series as Array<Record<string, unknown>>) || [];
  const first = series.find((s) => SUPPORTED.has(String(s.type || chartType))) || series[0];
  if (!first) return null;

  const encode = first.encode as Record<string, unknown> | undefined;
  const dimensions = (ds?.dimensions as string[] | undefined) || Object.keys(rows[0] || {});
  let xKey = encodeDimensionName(encode, 'x');
  let yKey = encodeDimensionName(encode, 'y');

  if (xKey && !Number.isNaN(Number(xKey))) {
    xKey = dimensions[Number(xKey)] || xKey;
  }
  if (yKey && !Number.isNaN(Number(yKey))) {
    yKey = dimensions[Number(yKey)] || yKey;
  }

  const keys = Object.keys(rows[0] || {});
  if (!xKey || !keys.includes(xKey)) {
    xKey =
      keys.find((k) => typeof rows[0][k] === 'string') ||
      keys.find((k) => !/^(id|_id)$/i.test(k)) ||
      keys[0];
  }
  if (!yKey || !keys.includes(yKey)) {
    yKey =
      keys.find((k) => k !== xKey && typeof rows[0][k] === 'number') ||
      keys.find((k) => k !== xKey && !Number.isNaN(Number(rows[0][k]))) ||
      keys.find((k) => k !== xKey) ||
      keys[1];
  }
  if (!xKey || !yKey) return null;

  const x = rows.map((r) => String(r[xKey] ?? ''));
  const mappedSeries = series
    .filter((s) => SUPPORTED.has(String(s.type || chartType)))
    .map((s, i) => {
      const enc = s.encode as Record<string, unknown> | undefined;
      let metricKey = encodeDimensionName(enc, 'y') || yKey;
      if (metricKey && !Number.isNaN(Number(metricKey))) {
        metricKey = dimensions[Number(metricKey)] || metricKey;
      }
      const data = rows.map((r) => Number(r[metricKey]) || 0);
      return { name: String(s.name || metricKey || `Series ${i + 1}`), data };
    });

  if (!mappedSeries.length || !x.length) return null;

  return {
    chartType,
    chartData: {
      x,
      y: mappedSeries[0]?.data || [],
      series: mappedSeries,
    },
    chartOptions: { ...CHART_ANIMATION_DEFAULTS, animation: cfg.animation ?? true },
    chartQuery: { x: xKey, yMetric: yKey },
  };
}

function buildFromEchartsConfig(cfg: Record<string, unknown>, chartType: string): SharedChartProps | null {
  if (chartType === 'heatmap') {
    return buildHeatmapFromEcharts(cfg);
  }
  if (chartType === 'scatter') {
    const scatter = buildScatterFromEchartsConfig(cfg);
    if (scatter) return scatter;
  }

  const ds = cfg.dataset as Record<string, unknown> | undefined;
  const dsSource = ds?.source as unknown[] | undefined;
  const series = (cfg.series as Array<Record<string, unknown>>) || [];
  const usesDatasetEncode =
    Array.isArray(dsSource) &&
    dsSource.length > 0 &&
    series.some((s) => s.encode && typeof s.encode === 'object');

  if (usesDatasetEncode) {
    const fromDataset = buildFromDatasetEncode(cfg, chartType);
    if (fromDataset) return fromDataset;
  }

  const xAxis = Array.isArray(cfg.xAxis) ? (cfg.xAxis[0] as Record<string, unknown>) : (cfg.xAxis as Record<string, unknown>);
  const xRaw = (xAxis?.data as unknown[]) || [];
  const x = xRaw.map((v) => String(v ?? ''));

  const mappedSeries = series
    .filter((s) => SUPPORTED.has(String(s.type || chartType)))
    .map((s, i) => {
      const raw = (s.data as unknown[]) || [];
      const data = raw.map((d) => {
        if (d && typeof d === 'object' && 'value' in (d as object)) {
          return Number((d as { value: unknown }).value) || 0;
        }
        if (Array.isArray(d)) return Number(d[1]) || Number(d[0]) || 0;
        return Number(d) || 0;
      });
      return { name: String(s.name || `Series ${i + 1}`), data };
    });

  if (!mappedSeries.length || (!x.length && !mappedSeries[0]?.data?.length)) return null;

  const chartData: ChartData = {
    x: x.length ? x : mappedSeries[0].data.map((_, i) => String(i + 1)),
    y: mappedSeries[0]?.data || [],
    series: mappedSeries,
  };

  return {
    chartType,
    chartData,
    chartOptions: { ...CHART_ANIMATION_DEFAULTS, animation: cfg.animation ?? true },
    chartQuery: {},
  };
}

/** Map chat echarts payload + query rows to dashboard WidgetRenderer props when safe. */
export function resolveSharedChartProps(
  config: unknown,
  queryResult: Record<string, unknown>[] | null | undefined,
  message?: unknown
): SharedChartProps | null {
  const hydrated = hydrateChartConfigFromQueryResult(config, queryResult);
  const cfg = rawConfig(hydrated);
  if (!cfg.series) return null;
  if (isComplexEcharts(cfg)) return null;

  const chartType = inferChartType(cfg);
  if (!chartType) return null;

  // Prefer populated ECharts option over re-inferring columns from query rows
  const series = (cfg.series as Array<Record<string, unknown>>) || [];
  const hasPopulatedSeries = series.some((s) => {
    const raw = (s.data as unknown[]) || [];
    return raw.length > 0;
  });
  const hasDatasetSource =
    cfg.dataset &&
    typeof cfg.dataset === 'object' &&
    Array.isArray((cfg.dataset as Record<string, unknown>).source) &&
    ((cfg.dataset as Record<string, unknown>).source as unknown[]).length > 0;

  if (hasPopulatedSeries || hasDatasetSource) {
    const fromCfg = buildFromEchartsConfig(cfg, chartType);
    if (fromCfg) return tagChatSource(fromCfg);
  }

  if (queryResult && queryResult.length > 0) {
    const fromRows = buildFromQueryResult(queryResult, chartType, message);
    if (fromRows) {
      fromRows.chartOptions = {
        ...fromRows.chartOptions,
        ...CHART_ANIMATION_DEFAULTS,
        animation: cfg.animation ?? (config as Record<string, unknown>)?.__animate ?? true,
      };
      return tagChatSource(fromRows);
    }
  }

  const fallback = buildFromEchartsConfig(cfg, chartType);
  return fallback ? tagChatSource(fallback) : null;
}

/** Build dashboard WidgetRenderer props from query rows (used for chat chart-type switching). */
export function buildSharedChartPropsForType(
  rows: Record<string, unknown>[],
  chartType: string,
  message?: unknown,
): SharedChartProps | null {
  if (!rows.length || chartType === 'table') return null;

  const props = buildFromQueryResult(rows, chartType, message);
  if (!props) return null;

  const chartOptions: Record<string, unknown> = {
    ...props.chartOptions,
    ...CHART_ANIMATION_DEFAULTS,
    showLegend: chartType === 'pie' || chartType === 'donut' ? true : props.chartOptions?.showLegend,
  };
  if (chartType === 'donut') {
    chartOptions.innerRadius = 40;
  } else if (chartType === 'pie') {
    chartOptions.innerRadius = 0;
  }

  return tagChatSource({
    ...props,
    chartType,
    chartOptions,
  });
}
