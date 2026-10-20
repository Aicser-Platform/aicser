/**
 * Agent Context Contract (ACC) — shared envelope for embedded copilots + /ai/analyze.
 */

export type SurfaceKind = 'chat' | 'dashboard' | 'notebook' | 'sheet';
export type SurfaceIntent = 'ask' | 'explain' | 'build' | 'refine' | 'mutate';

export type SurfaceContext = {
  surface: SurfaceKind;
  surface_ref?: { id?: string; version?: number; title?: string };
  intent?: SurfaceIntent;
  selection?: {
    widget_id?: string;
    cell_id?: string;
    sheet_name?: string;
    range_a1?: string;
    table_name?: string;
  };
  runtime?: {
    filters?: Record<string, unknown>[] | unknown[];
    parameters?: Record<string, unknown>;
    data_source_ids?: string[];
    ask_snapshot_stale?: boolean;
    linked_ask_data_source_id?: string;
    data_connectivity?: import('@/agent/surfaceDataConnectivity').SurfaceDataConnectivity;
  };
  artifacts?: {
    widgets?: Record<string, unknown>[];
    cells?: Record<string, unknown>[];
    ranges?: Record<string, unknown>[];
    frames?: Record<string, unknown>[];
    sheets?: Record<string, unknown>[];
    tables?: Record<string, unknown>[];
    data_quality?: Record<string, unknown>;
  };
  mutation_policy?: 'read_only' | 'propose' | 'auto_if_descriptive';
};

export function buildDashboardSurfaceContext(opts: {
  dashboardId: string;
  title?: string;
  widgetId?: string;
  intent?: SurfaceIntent;
  filters?: unknown[];
  dataSourceId?: string;
}): SurfaceContext {
  return {
    surface: 'dashboard',
    surface_ref: { id: opts.dashboardId, title: opts.title },
    intent: opts.intent ?? (opts.widgetId ? 'explain' : 'ask'),
    selection: opts.widgetId ? { widget_id: opts.widgetId } : undefined,
    runtime: {
      filters: opts.filters,
      data_source_ids: opts.dataSourceId ? [opts.dataSourceId] : undefined,
    },
    mutation_policy: opts.intent === 'build' ? 'propose' : 'read_only',
  };
}

export function buildNotebookSurfaceContext(opts: {
  notebookId: string;
  title?: string;
  intent?: SurfaceIntent;
  cells?: Array<{ id: string; cell_type: string; name?: string; status?: string }>;
  frames?: Array<{ name: string; columns?: string[]; row_count?: number }>;
  dataSourceId?: string;
}): SurfaceContext {
  return {
    surface: 'notebook',
    surface_ref: { id: opts.notebookId, title: opts.title },
    intent: opts.intent ?? 'ask',
    artifacts: {
      cells: opts.cells,
      frames: opts.frames,
    },
    runtime: {
      data_source_ids: opts.dataSourceId ? [opts.dataSourceId] : undefined,
    },
    // The assistant proposes changes; the person reviews and applies them.
    mutation_policy: 'propose',
  };
}

export function buildSheetSurfaceContext(opts: {
  workbookId: string;
  title?: string;
  intent?: SurfaceIntent;
  ranges?: Array<{ id?: string; name?: string; sql?: string; mode?: string }>;
  selectionA1?: string;
  sheetName?: string;
  parameters?: Record<string, unknown>;
  askSnapshotStale?: boolean;
  linkedAskDataSourceId?: string;
  dataSourceId?: string;
}): SurfaceContext {
  return {
    surface: 'sheet',
    surface_ref: { id: opts.workbookId, title: opts.title },
    intent: opts.intent ?? 'ask',
    selection: {
      range_a1: opts.selectionA1,
      sheet_name: opts.sheetName,
    },
    artifacts: { ranges: opts.ranges },
    runtime: {
      parameters: opts.parameters,
      ask_snapshot_stale: opts.askSnapshotStale,
      linked_ask_data_source_id: opts.linkedAskDataSourceId,
      data_source_ids: opts.dataSourceId ? [opts.dataSourceId] : undefined,
    },
    // The assistant proposes changes; the person reviews and applies them.
    mutation_policy: 'propose',
  };
}

/** True when the user is asking to generate a whole artifact (not casual "build a chart"). */
export function isWholeArtifactBuildGoal(ctx: SurfaceContext, query: string): boolean {
  if (ctx.intent === 'build') return true;
  const q = query.trim().toLowerCase();
  return (
    /\b(build|create|draft|generate)\b.{0,24}\b(entire|full|whole|complete)\b/i.test(query) ||
    /\b(build|create|draft|generate)\b.{0,20}\b(notebook|sheet|workbook|dashboard)\b/i.test(q)
  );
}

/** analysis_mode for an embedded assistant. On a notebook or sheet there is one assistant that
 * answers and, when asked, changes the artifact (the model decides which), so it never depends
 * on the wording; a dashboard build request still goes to the dashboard builder. */
export function analysisModeForSurface(ctx: SurfaceContext, query: string): string | undefined {
  if (ctx.surface === 'notebook') return 'notebook_advisor';
  if (ctx.surface === 'sheet') return 'sheet_advisor';
  if (ctx.surface === 'dashboard' && isWholeArtifactBuildGoal(ctx, query)) return 'dashboard';
  return undefined;
}

/** Refine ACC intent from the latest user message (avoid flipping to build on loose keywords). */
export function surfaceIntentForQuery(ctx: SurfaceContext, query: string): SurfaceContext['intent'] {
  if (isWholeArtifactBuildGoal(ctx, query)) return 'build';
  if (/\b(explain|why does|what does|interpret)\b/i.test(query)) return 'explain';
  if (/\b(refine|tweak|adjust|fix|improve)\b/i.test(query)) return 'refine';
  return ctx.intent ?? 'ask';
}
