/**
 * Upsert helpers so Chat pin / Customize share the Query Editor bind path:
 * durable saved_query_id + sample_sql fallback.
 */

import { fetchApi } from '@/utils/api';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';

function scopedQs(
  organizationId?: string | null,
  projectId?: string | number | null,
): string {
  const params = new URLSearchParams();
  if (organizationId) params.set('organization_id', String(organizationId));
  if (projectId != null && String(projectId).trim() !== '') {
    params.set('project_id', String(projectId));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function resolveScope(opts?: {
  organizationId?: string | null;
  projectId?: string | number | null;
}): { organizationId: string | null; projectId: string | number | null } {
  return {
    organizationId:
      opts?.organizationId ??
      useOrganizationStore.getState().currentOrganization?.id ??
      null,
    projectId: opts?.projectId ?? useProjectStore.getState().currentProjectId ?? null,
  };
}

/** Find an existing saved query with identical SQL within scope to avoid duplicates. */
export async function findMatchingSavedQuery(opts: {
  sql: string;
  organizationId?: string | null;
  projectId?: string | number | null;
}): Promise<string | null> {
  const sql = opts.sql?.trim();
  if (!sql) return null;
  const { organizationId, projectId } = resolveScope(opts);
  const qs = scopedQs(organizationId, projectId);
  try {
    const res = await fetchApi<{ items?: Array<{ id: string | number; sql: string }> }>(
      `queries/saved-queries${qs}`,
      { method: 'GET' },
    );
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    const match = res?.items?.find(
      (item) => item.sql?.replace(/\s+/g, ' ').trim().toLowerCase() === normalized,
    );
    return match?.id != null ? String(match.id) : null;
  } catch {
    return null;
  }
}

/** Create a saved query; reuses an existing matching query if one exists, or creates a new one. */
export async function createSavedQuery(opts: {
  name: string;
  sql: string;
  metadata?: Record<string, unknown>;
  organizationId?: string | null;
  projectId?: string | number | null;
}): Promise<string | null> {
  const sql = opts.sql?.trim();
  if (!sql) return null;

  // De-duplication check: if a saved query with identical SQL already exists in this scope, reuse it
  const existingId = await findMatchingSavedQuery(opts);
  if (existingId) return existingId;

  const { organizationId, projectId } = resolveScope(opts);
  const qs = scopedQs(organizationId, projectId);
  const baseName = (opts.name || 'Query from chat').trim().slice(0, 160) || 'Query from chat';

  for (let attempt = 0; attempt < 6; attempt++) {
    const name =
      attempt === 0
        ? baseName
        : attempt < 5
          ? `${baseName} (${attempt + 1})`
          : `${baseName} ${Date.now()}`;
    try {
      const created = await fetchApi<{ id?: string | number }>(`queries/saved-queries${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          sql,
          metadata: opts.metadata || {},
        }),
      });
      if (created?.id != null) return String(created.id);
      return null;
    } catch (err: unknown) {
      const msg = String(
        (err as { message?: string; detail?: string })?.message ||
          (err as { detail?: string })?.detail ||
          '',
      );
      if (/already exists/i.test(msg)) continue;
      console.warn('[createSavedQuery]', err);
      return null;
    }
  }
  return null;
}

type PinLike = {
  chartType?: string;
  title: string;
  // Callers' concrete chartQuery/chartOptions types are often named
  // interfaces (e.g. ChartQuery) with no index signature, which isn't
  // structurally assignable to Record<string, unknown> even though every
  // property is unknown-compatible -- `unknown` avoids that TS quirk. The
  // function body below casts these internally regardless.
  chartQuery?: unknown;
  chartOptions?: unknown;
  dataSourceId?: string | null;
};

/**
 * If the pin has SQL but no saved_query_id, persist a Saved Query and attach the id.
 * Clears sample_sql when bound so live refresh uses the editable saved query
 * (same as Query Editor Visualize).
 */
export async function attachSavedQueryToPinPayload<T extends PinLike>(
  payload: T,
  sql?: string | null,
  opts?: { organizationId?: string | null; projectId?: string | number | null; source?: string },
): Promise<T> {
  const prev = (payload.chartQuery || {}) as Record<string, unknown>;
  if (prev.saved_query_id != null && String(prev.saved_query_id).trim() !== '') {
    return payload;
  }

  const prevOptions = (payload.chartOptions || {}) as Record<string, unknown>;
  const sqlText = (
    sql ||
    (typeof prevOptions.sample_sql === 'string' ? prevOptions.sample_sql : '') ||
    ''
  ).trim();
  if (!sqlText) return payload;

  const dsId = payload.dataSourceId ? String(payload.dataSourceId) : undefined;
  const id = await createSavedQuery({
    name: payload.title || 'Chart from chat',
    sql: sqlText,
    organizationId: opts?.organizationId,
    projectId: opts?.projectId,
    metadata: {
      source: opts?.source || 'ai_chat',
      data_source_id: dsId,
      dataSourceId: dsId,
    },
  });
  if (!id) return payload;

  const nextOptions: Record<string, unknown> = { ...prevOptions };
  delete nextOptions.sample_sql;

  const nextQuery: Record<string, unknown> = {
    ...prev,
    saved_query_id: id,
    yMetric: prev.yMetric ?? 'none',
    joins: [],
  };
  delete nextQuery.tableName;

  return {
    ...payload,
    chartOptions: nextOptions,
    chartQuery: nextQuery,
  } as T;
}
