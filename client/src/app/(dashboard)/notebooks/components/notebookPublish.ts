/**
 * Publishing a notebook chart or pivot to the chart library or a dashboard, bound to its data:
 * a SQL result becomes a saved query (live — dashboards re-run it under each viewer's row
 * security), a Python result is saved as a dataset first (a snapshot, refreshed by re-saving).
 * The chart's settings map onto the dashboard chart model, so it opens editable in the designer.
 */
import type { ChartSpec, NotebookCell } from '@/services/notebookService';
import { defaultAgg } from './NotebookChart';

export type PublishSource =
  | { kind: 'sql'; name: string; sql: string; dataSourceId: string }
  | { kind: 'python'; name: string }
  | { kind: 'missing'; name: string };

/** Where the chart's data comes from: the SQL cell that makes the result, or a Python frame. */
export function publishSource(cell: NotebookCell, cells: NotebookCell[]): PublishSource {
  const from = cell.chart?.from ?? '';
  const producer = cells.find((c) => c.type === 'sql' && c.name === from);
  if (producer?.data_source_id && producer.source.trim()) {
    return { kind: 'sql', name: from, sql: producer.source.trim(), dataSourceId: producer.data_source_id };
  }
  return from ? { kind: 'python', name: from } : { kind: 'missing', name: from };
}

const AGG: Record<string, string> = { sum: 'sum', avg: 'avg', count: 'count', min: 'min', max: 'max', none: 'none' };

/** The dashboard chart model for a notebook chart or pivot (plus what couldn't be carried over). */
export function chartModelFor(cell: NotebookCell): {
  chartType: string;
  chartQuery: Record<string, unknown>;
  chartOptions: Record<string, unknown>;
  dropped: string[];
} {
  const spec: ChartSpec = cell.chart || {};
  const dropped: string[] = [];
  if (cell.type === 'pivot') {
    const agg = spec.values?.length ? AGG[spec.agg && spec.agg !== 'none' ? spec.agg : 'sum'] : 'count';
    if ((spec.rows?.length ?? 0) > 1) dropped.push('rows');
    if ((spec.columns?.length ?? 0) > 1) dropped.push('columns');
    return {
      chartType: 'table',
      chartQuery: {
        x: spec.rows?.[0],
        aggregate: true,
        yMetric: spec.values?.length ? 'none' : 'count',
        yMetrics: (spec.values ?? []).map((field) => ({ field, aggregation: agg })),
        ...(spec.columns?.[0] ? { groupBy: true, groupField: spec.columns[0], legend: spec.columns[0] } : {}),
        sortBy: 'x',
        sortOrder: 'asc',
      },
      chartOptions: {},
      dropped,
    };
  }
  const agg = defaultAgg(spec);
  const type = spec.type || 'bar';
  const y = spec.y ?? [];
  return {
    chartType: type,
    chartQuery: {
      x: spec.x,
      aggregate: agg !== 'none',
      yMetric: y.length ? 'none' : agg === 'count' ? 'count' : 'none',
      yMetrics: y.map((field) => ({ field, aggregation: AGG[agg] })),
      ...(spec.series && y.length <= 1 ? { groupBy: true, groupField: spec.series, legend: spec.series } : {}),
      sortBy: type === 'line' || type === 'area' ? 'x' : 'y',
      sortOrder: type === 'line' || type === 'area' ? 'asc' : 'desc',
      ...(type === 'bar' ? { limit: 25 } : type === 'pie' ? { limit: 10 } : {}),
    },
    chartOptions: {
      // The dashboard's own option names (Properties panel → orientation / stacking).
      ...(type === 'bar' ? { barChartType: spec.horizontal ? 'horizontal' : 'vertical', barStackMode: spec.stacked ? 'stacked' : 'none' } : {}),
      ...(type === 'line' || type === 'area' ? { lineStackMode: spec.stacked ? 'stacked' : 'none' } : {}),
      showLegend: Boolean(spec.series) || y.length > 1 || type === 'pie',
    },
    dropped,
  };
}
