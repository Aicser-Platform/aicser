import type { ChartData } from '../services/chartService';
import type { WidgetInstance } from '../stores/useDashboardStore';

/** Split combined series payload into primary / secondary axes when needed. */
export function partitionSeriesData(data: ChartData, widget: Pick<WidgetInstance, 'chartType' | 'chartQuery'>): ChartData {
  if (data.secondarySeries && data.secondarySeries.length > 0) return data;

  const cartesianTypes = ['line', 'bar'];
  if (!cartesianTypes.includes(widget.chartType) || !data.series || data.series.length === 0) return data;

  const yMetricsCount = widget.chartQuery?.yMetrics?.length || 0;
  const secondaryMetricsCount = widget.chartQuery?.yMetricsSecondary?.length || 0;

  if (secondaryMetricsCount === 0) return data;

  const series = data.series.slice(0, yMetricsCount);
  const secondarySeries = data.series.slice(yMetricsCount, yMetricsCount + secondaryMetricsCount);

  return { ...data, series, secondarySeries };
}
