import type { SurfaceContext } from '@/agent/surfaceContext';

export type SurfaceDataConnectivity = {
  has_warehouse_source: boolean;
  has_embedded_grid_data: boolean;
  has_live_sql_ranges: boolean;
  has_dashboard_widgets: boolean;
  has_notebook_data: boolean;
  embedded_table_count: number;
  embedded_row_sample_count: number;
  can_analyze_without_sidebar_source: boolean;
  summary: string;
};

export function buildSurfaceDataConnectivity(ctx: SurfaceContext): SurfaceDataConnectivity {
  const rt = ctx.runtime ?? {};
  const arts = ctx.artifacts ?? {};
  const tables = arts.tables ?? [];
  const ranges = arts.ranges ?? [];
  const widgets = arts.widgets ?? [];
  const cells = arts.cells ?? [];
  const frames = arts.frames ?? [];

  const tableCount = tables.length;
  const rowSamples = tables.reduce(
    (n, t) => n + (Number(t.row_count) || (Array.isArray(t.sample_rows) ? t.sample_rows.length : 0)),
    0,
  );

  const hasWarehouse = Boolean(
    rt.linked_ask_data_source_id || (rt.data_source_ids && rt.data_source_ids.length > 0),
  );
  const hasGrid = tableCount > 0;
  const hasRanges = ranges.length > 0;
  const hasWidgets = widgets.length > 0;
  const hasNotebook = cells.length > 0 || frames.length > 0;
  const canAnalyze = hasWarehouse || hasGrid || hasRanges || hasWidgets || hasNotebook;

  const parts: string[] = [];
  if (hasGrid) parts.push(`${tableCount} table(s) on this sheet`);
  if (hasRanges) parts.push(`${ranges.length} live SQL range(s)`);
  if (hasWarehouse) parts.push('warehouse / Ask snapshot linked');
  if (hasWidgets) parts.push(`${widgets.length} widget(s) on dashboard`);
  if (hasNotebook) parts.push(`${cells.length} cell(s) in notebook`);

  return {
    has_warehouse_source: hasWarehouse,
    has_embedded_grid_data: hasGrid,
    has_live_sql_ranges: hasRanges,
    has_dashboard_widgets: hasWidgets,
    has_notebook_data: hasNotebook,
    embedded_table_count: tableCount,
    embedded_row_sample_count: rowSamples,
    can_analyze_without_sidebar_source: canAnalyze,
    summary: parts.length ? parts.join(' · ') : 'No tables or sources in this view yet',
  };
}

export function withSurfaceDataConnectivity(ctx: SurfaceContext): SurfaceContext {
  const data_connectivity = buildSurfaceDataConnectivity(ctx);
  return {
    ...ctx,
    runtime: {
      ...ctx.runtime,
      data_connectivity,
    },
  };
}
