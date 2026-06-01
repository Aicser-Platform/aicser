/**
 * Client-side ECharts config transform — shared by chat charts and dashboard preview.
 * Mirrors the dashboard Properties "Chart Type" dropdown behavior without a server round-trip.
 */

export type TransformChartTypeResult =
  | { viewType: 'table'; config: null }
  | { viewType: string; config: Record<string, unknown> };

function cloneConfig(source: unknown): Record<string, unknown> {
  if (!source || typeof source !== 'object') return {};
  return JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
}

/** Transform an ECharts option object to a different chart type. */
export function transformEchartsChartType(
  sourceConfig: unknown,
  targetType: string,
): TransformChartTypeResult {
  if (targetType === 'table') {
    return { viewType: 'table', config: null };
  }

  const cfg = cloneConfig(sourceConfig);
  if (!sourceConfig) {
    return { viewType: targetType, config: cfg };
  }

  if (targetType === 'bar' || targetType === 'line' || targetType === 'area') {
    const series = Array.isArray(cfg.series) ? cfg.series : [];
    cfg.series = series.map((s: Record<string, unknown>) => ({
      ...s,
      type: targetType === 'area' ? 'line' : targetType,
      areaStyle: targetType === 'area' ? { opacity: 0.25 } : undefined,
      smooth: targetType === 'line' || targetType === 'area',
      symbol: targetType === 'line' ? 'circle' : undefined,
      symbolSize: targetType === 'line' ? 6 : undefined,
      stack: undefined,
    }));
    if (!cfg.xAxis) cfg.xAxis = { type: 'category', data: [] };
    if (!cfg.yAxis) cfg.yAxis = { type: 'value' };
    return { viewType: targetType, config: cfg };
  }

  if (targetType === 'pie' || targetType === 'donut') {
    const xAxis = cfg.xAxis as Record<string, unknown> | undefined;
    const series0 = (Array.isArray(cfg.series) ? cfg.series[0] : undefined) as
      | Record<string, unknown>
      | undefined;
    const xData = (xAxis?.data as unknown[]) || [];
    const yData = (series0?.data as unknown[]) || [];
    const pieData =
      xData.length > 0
        ? xData.map((name, i) => ({ name: String(name), value: (yData[i] as number) ?? 0 }))
        : yData.map((v, i) =>
            typeof v === 'object' && v !== null && 'name' in v && 'value' in v
              ? v
              : {
                  name: `Item ${i + 1}`,
                  value: typeof v === 'object' ? ((v as { value?: number }).value ?? 0) : (v ?? 0),
                },
          );
    const radius = targetType === 'donut' ? ['40%', '70%'] : '65%';
    return {
      viewType: targetType,
      config: {
        ...cfg,
        xAxis: undefined,
        yAxis: undefined,
        grid: undefined,
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: 0, type: 'scroll' },
        series: [{ type: 'pie', radius, data: pieData, label: { show: true } }],
      },
    };
  }

  if (targetType === 'scatter') {
    const xAxis = cfg.xAxis as Record<string, unknown> | undefined;
    const series0 = (Array.isArray(cfg.series) ? cfg.series[0] : undefined) as
      | Record<string, unknown>
      | undefined;
    const xData = (xAxis?.data as unknown[]) || [];
    const yData = (series0?.data as unknown[]) || [];
    const scatterData = yData.map((v, i) => {
      const xVal =
        xData[i] !== undefined ? (Number.isNaN(Number(xData[i])) ? i : Number(xData[i])) : i;
      const yVal = typeof v === 'object' ? ((v as { value?: number })?.value ?? 0) : (v ?? 0);
      return [xVal, Number(yVal)];
    });
    return {
      viewType: targetType,
      config: {
        ...cfg,
        xAxis: { type: 'value' },
        yAxis: { type: 'value' },
        series: [{ type: 'scatter', data: scatterData, symbolSize: 8 }],
      },
    };
  }

  const series = Array.isArray(cfg.series) ? cfg.series : [];
  cfg.series = series.map((s: Record<string, unknown>) => ({ ...s, type: targetType }));
  return { viewType: targetType, config: cfg };
}
