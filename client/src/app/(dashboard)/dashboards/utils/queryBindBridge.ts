/**
 * Query Editor → Chart Designer / Dashboard bind bridge.
 *
 * Industry pattern (Metabase / Tableau / Power BI):
 *   Run query → Visualize → Save as live SQL dataset OR freeze snapshot → Pin to target.
 */

export type BindTarget = 'dashboard' | 'chart-designer';
export type BindDataMode = 'live' | 'snapshot';

export type BindColumn = { name: string; type?: string };

export type SavedQueryBindPayload = {
  savedQueryId?: string | number;
  /** Frozen result set id from /api/queries/snapshots */
  querySnapshotId?: string | number;
  name?: string;
  sql?: string;
  dataSourceId?: string;
  columns?: BindColumn[];
  /** Pre-mapped chart query fields */
  chartQuery?: Record<string, unknown>;
  /** Immediate render payload (esp. snapshot / empty-agg cases) */
  chartData?: Record<string, unknown>;
  chartType?: string;
  dataMode?: BindDataMode;
  target?: BindTarget;
  /** Specific dashboard to open / pin into */
  dashboardId?: string;
  /** Chart already persisted server-side — dashboard should select, not recreate */
  preCreatedChartId?: string;
  stagedAt?: number;
};

const STORAGE_KEY = 'aicser:bind-saved-query';

export function stageSavedQueryBind(payload: SavedQueryBindPayload): void {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...payload, stagedAt: Date.now() }),
    );
  } catch {
    /* ignore quota */
  }
}

export function peekSavedQueryBind(maxAgeMs = 15 * 60 * 1000): SavedQueryBindPayload | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedQueryBindPayload;
    if (parsed.stagedAt && Date.now() - parsed.stagedAt > maxAgeMs) return null;
    if (parsed.savedQueryId == null && parsed.querySnapshotId == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function consumeSavedQueryBind(maxAgeMs = 15 * 60 * 1000): SavedQueryBindPayload | null {
  const parsed = peekSavedQueryBind(maxAgeMs);
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return parsed;
}

export function clearSavedQueryBind(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function wrapSqlAsSubquery(sql: string, limit = 50): string {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  return `SELECT * FROM (${trimmed}) AS _aicser_saved LIMIT ${Math.max(1, limit)}`;
}

const NUMERIC_RE = /(int|float|double|decimal|numeric|number|real|money)/i;
const DATE_RE = /(date|time|timestamp|datetime)/i;
const ID_NAME_RE = /(^id$|_id$|_key$)/i;

function isNumericCellValue(val: unknown): boolean {
  if (typeof val === 'number' && Number.isFinite(val)) return true;
  if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) return true;
  return false;
}

/** Infer column type from sample cells when driver type is missing/unknown. */
export function inferBindColumnTypeFromSamples(
  name: string,
  rows: Array<Record<string, unknown>> | undefined,
  declaredType?: string,
): string {
  const declared = (declaredType || '').trim();
  if (declared && declared !== 'unknown' && !/^object$/i.test(declared)) {
    return declared;
  }
  if (DATE_RE.test(name) || ID_NAME_RE.test(name.toLowerCase())) {
    // Prefer dimension for ids/dates even when numeric-looking
    if (DATE_RE.test(name)) return declared || 'date';
  }
  const samples = (rows || []).slice(0, 25).map((r) => r[name]);
  const nonNull = samples.filter((v) => v != null && v !== '');
  if (!nonNull.length) return declared || 'unknown';
  const numericCount = nonNull.filter(isNumericCellValue).length;
  if (numericCount / nonNull.length >= 0.8 && !ID_NAME_RE.test(name.toLowerCase())) {
    return 'number';
  }
  if (nonNull.some((v) => typeof v === 'string' && DATE_RE.test(String(v)))) return 'date';
  return declared || 'string';
}

export function columnsFromQueryResult(result: {
  columns?: string[] | Array<{ name?: string; type?: string }>;
  data?: Array<Record<string, unknown>>;
}): BindColumn[] {
  const rows = Array.isArray(result.data) ? result.data : undefined;
  if (Array.isArray(result.columns) && result.columns.length) {
    return result.columns
      .map((c) => {
        const name = typeof c === 'string' ? c : String(c?.name || '');
        const declared = typeof c === 'string' ? 'unknown' : c?.type || 'unknown';
        return {
          name,
          type: inferBindColumnTypeFromSamples(name, rows, declared),
        };
      })
      .filter((c) => c.name);
  }
  const row = rows?.[0];
  if (row && typeof row === 'object') {
    return Object.keys(row).map((name) => ({
      name,
      type: inferBindColumnTypeFromSamples(name, rows, typeof row[name] === 'number' ? 'number' : 'string'),
    }));
  }
  return [];
}

export function isNumericBindColumn(col: BindColumn): boolean {
  if (ID_NAME_RE.test((col.name || '').toLowerCase())) return false;
  if (DATE_RE.test(col.type || '') || DATE_RE.test(col.name || '')) return false;
  if (NUMERIC_RE.test(col.type || '')) return true;
  return false;
}

export type InferChartMappingOptions = {
  /** Sample rows — used to refine unknown column types */
  sampleRows?: Array<Record<string, unknown>>;
  /**
   * Saved/custom SQL is usually already projected — default measure agg to none.
   * Table-mode Build can pass false to keep sum/count defaults.
   */
  preferNoneAggregation?: boolean;
  maxMeasures?: number;
};

export type InferredChartMapping = {
  x?: string;
  groupField?: string;
  yMetrics: Array<{ field: string; aggregation: string }>;
};

/**
 * Infer X (category) + optional Legend break-by + Y measures — Metabase/Power BI style.
 * With 2+ dimensions and one measure → X + groupField.
 * With multiple measures → multi Y (groupField omitted; XOR with break-by).
 */
export function inferChartMapping(
  columns: BindColumn[],
  chartType = 'bar',
  opts: InferChartMappingOptions = {},
): InferredChartMapping {
  if (!columns.length) return { yMetrics: [] };

  const enriched = columns.map((c) => ({
    ...c,
    type: inferBindColumnTypeFromSamples(c.name, opts.sampleRows, c.type),
  }));
  const dims = enriched.filter((c) => !isNumericBindColumn(c));
  const measures = enriched.filter((c) => isNumericBindColumn(c));
  const measureAgg = opts.preferNoneAggregation === false ? 'sum' : 'none';
  const maxMeasures = opts.maxMeasures ?? 5;

  if (chartType === 'stat' || chartType === 'gauge') {
    const field = measures[0]?.name || columns[0]?.name;
    return {
      yMetrics: field
        ? [
            {
              field,
              aggregation:
                opts.preferNoneAggregation === false
                  ? measures[0]
                    ? 'sum'
                    : 'count'
                  : 'none',
            },
          ]
        : [],
    };
  }

  const x = dims[0]?.name || columns[0]?.name;
  // Second categorical → Legend when a single measure (long-form break-by).
  // Multiple measures → multi-Y (industry: don't auto-break when several value cols exist).
  const groupField =
    measures.length <= 1 && dims.length >= 2 && dims[1]?.name !== x
      ? dims[1]?.name
      : undefined;

  if (measures.length) {
    return {
      x,
      ...(groupField ? { groupField } : {}),
      yMetrics: measures.slice(0, maxMeasures).map((m) => ({
        field: m.name,
        aggregation: measureAgg,
      })),
    };
  }

  // All text / unknown: treat second column as value with none (common for AI SQL counts as text)
  const yField = columns.find((c) => c.name !== x)?.name || columns[0]?.name;
  return {
    x,
    yMetrics: yField ? [{ field: yField, aggregation: 'none' }] : [],
  };
}

/** Map raw result rows → renderer {x,y,series} using inferred / explicit fields. */
export function buildChartDataFromRows(
  rows: Array<Record<string, unknown>>,
  opts: {
    chartType?: string;
    x?: string;
    groupField?: string;
    yMetrics?: Array<{ field: string; aggregation?: string }>;
  } = {},
): Record<string, unknown> {
  if (!rows?.length) return { x: [], y: [], series: [] };
  const columns = Object.keys(rows[0] || {});
  const chartType = opts.chartType || 'bar';
  const inferred = inferChartMapping(
    columns.map((name) => ({
      name,
      type: typeof rows[0][name] === 'number' ? 'number' : 'string',
    })),
    chartType,
    { sampleRows: rows, preferNoneAggregation: true },
  );
  const xField = opts.x || inferred.x || columns[0];
  const yMetrics = opts.yMetrics?.length ? opts.yMetrics : inferred.yMetrics;

  if (chartType === 'stat' || chartType === 'gauge') {
    const field = yMetrics[0]?.field || columns[0];
    const last = rows[rows.length - 1];
    return { value: last?.[field!] ?? null };
  }

  const x = rows.map((r) => r[xField!]);
  const series = yMetrics
    .filter((m) => m.field && columns.includes(m.field))
    .map((m) => ({
      name: m.field,
      data: rows.map((r) => {
        const v = r[m.field];
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : 0;
      }),
    }));

  if (!series.length && columns.length > 1) {
    const yCol = columns.find((c) => c !== xField) || columns[1];
    series.push({
      name: yCol,
      data: rows.map((r) => {
        const v = r[yCol];
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : 0;
      }),
    });
  }

  const out: Record<string, unknown> = {
    x,
    y: series[0]?.data || [],
    series,
  };
  const groupField = opts.groupField || inferred.groupField;
  if (groupField && columns.includes(groupField)) {
    out.group_field = rows.map((r) => r[groupField]);
  }
  return out;
}

export function buildChartQueryFromBind(payload: SavedQueryBindPayload): Record<string, unknown> {
  const chartType = payload.chartType || 'bar';
  const mapping = inferChartMapping(payload.columns || [], chartType, {
    preferNoneAggregation: true,
  });
  const explicit = payload.chartQuery && Object.keys(payload.chartQuery).length ? payload.chartQuery : null;
  const rawY =
    (explicit?.yMetrics as Array<{ field: string; aggregation?: string }> | undefined)?.length
      ? (explicit!.yMetrics as Array<{ field: string; aggregation?: string }>)
      : mapping.yMetrics;
  // Saved SQL results are typically already projected/aggregated — use none unless explicit.
  const yMetrics = rawY.map((m) => ({
    field: m.field,
    aggregation:
      explicit?.yMetrics && (explicit.yMetrics as unknown[]).length
        ? m.aggregation || 'none'
        : 'none',
  }));
  const x = (explicit?.x as string | undefined) ?? mapping.x;
  const groupField =
    (explicit?.groupField as string | undefined) ||
    (explicit?.legend as string | undefined) ||
    (yMetrics.length <= 1 ? mapping.groupField : undefined);

  const q: Record<string, unknown> = {
    ...(explicit || {}),
    x,
    yMetrics,
    yMetric: (explicit?.yMetric as string | undefined) || 'none',
    sortBy: (explicit?.sortBy as string | undefined) || (x ? 'x' : 'record_order'),
  };

  if (groupField && yMetrics.length <= 1) {
    q.groupField = groupField;
    q.legend = groupField;
  } else {
    delete q.groupField;
    delete q.legend;
  }

  if (payload.querySnapshotId != null && payload.dataMode === 'snapshot') {
    q.query_snapshot_id = String(payload.querySnapshotId);
    if (payload.savedQueryId != null) q.saved_query_id = String(payload.savedQueryId);
  } else if (payload.savedQueryId != null) {
    q.saved_query_id = String(payload.savedQueryId);
    delete q.query_snapshot_id;
  }
  return q;
}

/** Build field mapping from modal X/Y picks (SQL rows are usually pre-aggregated → none). */
export function buildMappingFromFields(opts: {
  chartType?: string;
  xField?: string;
  yFields?: string[];
  groupField?: string;
  columns?: BindColumn[];
}): {
  x?: string;
  groupField?: string;
  yMetrics: Array<{ field: string; aggregation: string }>;
} {
  const chartType = opts.chartType || 'bar';
  const yFields = (opts.yFields || []).filter(Boolean);
  if (yFields.length || opts.xField || opts.groupField) {
    const groupField =
      opts.groupField && yFields.length <= 1 ? opts.groupField : undefined;
    return {
      x: opts.xField,
      ...(groupField ? { groupField } : {}),
      yMetrics: yFields.map((field) => ({ field, aggregation: 'none' })),
    };
  }
  return inferChartMapping(opts.columns || [], chartType, { preferNoneAggregation: true });
}

export function buildBindNavigateUrl(payload: SavedQueryBindPayload): string {
  if (payload.target === 'chart-designer') {
    return '/chart-designer?bind_saved_query=1';
  }
  // Prefer server-created chart deep-link (same as chat pin) — survives reload, no double-create
  if (payload.preCreatedChartId && payload.dashboardId) {
    const qs = new URLSearchParams({
      id: payload.dashboardId,
      mode: 'edit',
      chart: String(payload.preCreatedChartId),
    });
    return `/dashboards?${qs.toString()}`;
  }
  const qs = new URLSearchParams({ bind_saved_query: '1', mode: 'edit' });
  if (payload.dashboardId) qs.set('id', payload.dashboardId);
  return `/dashboards?${qs.toString()}`;
}
