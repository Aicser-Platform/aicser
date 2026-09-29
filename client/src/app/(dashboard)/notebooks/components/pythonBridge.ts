/**
 * What a notebook's Python can ask the page to do (aicser.*). Each kind maps to one governed
 * API the rest of Aicser already uses, called with the viewer's session — so permissions, row
 * security, plan features and approval rules all apply unchanged. Nothing else is reachable.
 */
import type { Frame } from '../hooks/usePythonRuntime';

type Api = <T>(endpoint: string, init?: RequestInit) => Promise<T>;
type Named = { id: string; name: string };

export type BridgeDeps = {
  api: Api;
  /** A query on a data source (named by name or id; null = the notebook's usual source). */
  query: (sql: string, source: string | null) => Promise<Frame>;
  /** The data source id for a name or id (null = the notebook's usual source). */
  sourceId: (source: string | null) => string;
  projectId?: string | null;
  signal?: AbortSignal;
  /** Messages the viewer reads (translated by the caller). */
  text: {
    enterpriseOnly: string;
    notFound: (what: 'model' | 'decision', name: string) => string;
    ambiguous: (what: 'model' | 'decision', name: string) => string;
  };
};

const PREDICT_BATCH = 1000;

function status(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

export function pick<T extends Named>(items: T[], ref: string, what: 'model' | 'decision', text: BridgeDeps['text']): T {
  const key = ref.trim();
  const byId = items.find((x) => x.id === key);
  if (byId) return byId;
  const matches = items.filter((x) => x.name.trim().toLowerCase() === key.toLowerCase());
  if (matches.length > 1) throw new Error(text.ambiguous(what, ref));
  if (!matches.length) throw new Error(text.notFound(what, ref));
  return matches[0];
}

export function createPythonBridge(deps: BridgeDeps) {
  const { api, signal, text } = deps;
  const post = <T>(endpoint: string, body: unknown) => api<T>(endpoint, { method: 'POST', body: JSON.stringify(body), signal });
  // Models and decisions are Enterprise features: in Community the routes don't exist.
  const ee = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (err) {
      // A route that doesn't exist answers FastAPI's bare "Not Found".
      if (status(err) === 404 && String((err as Error)?.message || '').trim() === 'Not Found') throw new Error(text.enterpriseOnly);
      throw err;
    }
  };
  // Models and decisions of this notebook's project, plus the ones shared organization-wide.
  const scope = deps.projectId ? `?project_id=${encodeURIComponent(deps.projectId)}` : '';
  let models: Array<Named & { task?: string }> | null = null;
  let decisions: Named[] | null = null;
  const listModels = async () => {
    models ??= (await ee(() => api<{ items: Array<Named & { task?: string }> }>(`/api/models${scope}`, { signal }))).items;
    return models;
  };
  const listDecisions = async () => {
    decisions ??= (await ee(() => api<{ definitions: Named[] }>(`/api/ai-decisions/definitions${scope}`, { signal }))).definitions;
    return decisions;
  };

  return async (kind: string, p: Record<string, unknown>): Promise<unknown> => {
    switch (kind) {
      case 'query':
        return deps.query(String(p.query ?? ''), p.source == null ? null : String(p.source));
      case 'models':
        return { items: await listModels() };
      case 'decisions':
        return { definitions: await listDecisions() };
      case 'predict': {
        const model = pick(await listModels(), String(p.model ?? ''), 'model', text);
        const columns = (p.columns as string[]) || [];
        const rows = ((p.rows as unknown[][]) || []).map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
        const predictions: unknown[] = [];
        const warnings = new Set<string>();
        let outputColumn = 'prediction';
        for (let i = 0; i < rows.length; i += PREDICT_BATCH) {
          const out = await post<{ output_column: string; predictions: unknown[]; warnings?: unknown[] }>(
            `/api/models/${encodeURIComponent(model.id)}/predict`, { rows: rows.slice(i, i + PREDICT_BATCH) });
          outputColumn = out.output_column || outputColumn;
          predictions.push(...out.predictions);
          for (const w of out.warnings || []) warnings.add(typeof w === 'string' ? w : JSON.stringify(w));
        }
        return { output_column: outputColumn, predictions, warnings: [...warnings] };
      }
      case 'forecast_model': {
        const model = pick(await listModels(), String(p.model ?? ''), 'model', text);
        return post(`/api/models/${encodeURIComponent(model.id)}/forecast`, { periods: p.periods });
      }
      case 'forecast_frame':
        return ee(() => post('/api/models/forecast-frame', p));
      case 'save_forecast':
        return ee(() => post('/api/models/forecast-models', {
          name: p.name, sql: p.sql, time_col: p.time_col, value_col: p.value_col, periods: p.periods,
          data_source_id: deps.sourceId(p.source == null ? null : String(p.source)),
          project_id: deps.projectId || undefined,
        }));
      case 'decide': {
        const d = pick(await listDecisions(), String(p.decision ?? ''), 'decision', text);
        return post(`/api/ai-decisions/definitions/${encodeURIComponent(d.id)}/decide`, { rows: p.rows, text_columns: p.text_columns });
      }
      default:
        throw new Error(`aicser can't do "${kind}" here.`);
    }
  };
}
