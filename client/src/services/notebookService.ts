import { fetchApi } from '@/utils/api';

export type CellType = 'markdown' | 'sql' | 'python' | 'chart' | 'pivot';

export type CellOutput = {
  kind: 'table' | 'text' | 'error' | 'image' | 'chart';
  columns?: string[];
  rows?: unknown[][];
  row_count?: number;
  text?: string;
  image?: string;
  ran_at?: string;
  duration_ms?: number;
};

export type ChartSpec = {
  from?: string;
  type?: 'bar' | 'line' | 'area' | 'pie' | 'scatter';
  x?: string;
  y?: string[];
  /** How rows with the same x are combined; 'none' plots every row. */
  agg?: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'none';
  /** A column whose values become separate series (colour). */
  series?: string | null;
  stacked?: boolean;
  horizontal?: boolean;
  sort?: 'value' | 'label' | 'none';
  /** Pivot table: row groups, column groups and the measures summarised. */
  rows?: string[];
  columns?: string[];
  values?: string[];
};

export type NotebookCell = {
  id: string;
  type: CellType;
  source: string;
  name?: string | null;
  data_source_id?: string | null;
  chart?: ChartSpec | null;
  collapsed?: boolean;
  output?: CellOutput | null;
};

export type NotebookSummary = {
  id: string;
  title: string;
  description?: string | null;
  visibility: 'private' | 'project';
  version: number;
  project_id?: string | null;
  folder_id?: string | null;
  is_owner: boolean;
  cell_count: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type Notebook = NotebookSummary & { cells: NotebookCell[] };

export type NotebookVersionSummary = {
  id: string;
  title: string;
  reason: 'created' | 'save' | 'restore' | 'before_restore';
  notebook_version: number;
  cell_count: number;
  is_me: boolean;
  created_at: string | null;
  updated_at: string | null;
};

const base = '/api/notebooks';

export const notebookService = {
  list: (projectId?: string | null) =>
    fetchApi<{ items: NotebookSummary[] }>(`${base}${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`),
  get: (id: string) => fetchApi<Notebook>(`${base}/${encodeURIComponent(id)}`),
  create: (body: { title: string; cells?: NotebookCell[]; project_id?: string | null }) =>
    fetchApi<Notebook>(base, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<Pick<Notebook, 'title' | 'description' | 'cells' | 'visibility'>> & { version: number }) =>
    fetchApi<Notebook>(`${base}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string) => fetchApi<void>(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restore: (id: string) => fetchApi<NotebookSummary>(`${base}/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  duplicate: (id: string) => fetchApi<Notebook>(`${base}/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  exportIpynb: (id: string) => fetchApi<Record<string, unknown>>(`${base}/${encodeURIComponent(id)}/export`),
  importIpynb: (notebook: Record<string, unknown>, title?: string, projectId?: string | null) =>
    fetchApi<Notebook>(`${base}/import`, {
      method: 'POST',
      body: JSON.stringify({ notebook, title, project_id: projectId || undefined }),
    }),
  versions: (id: string) =>
    fetchApi<{ items: NotebookVersionSummary[] }>(`${base}/${encodeURIComponent(id)}/versions`),
  version: (id: string, versionId: string) =>
    fetchApi<{ id: string; title: string; cells: NotebookCell[]; reason: string; updated_at: string | null }>(
      `${base}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`),
  restoreVersion: (id: string, versionId: string) =>
    fetchApi<Notebook>(`${base}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST' }),
  saveDataset: (name: string, columns: string[], rows: unknown[][], projectId?: string | null) =>
    fetchApi<{ success: boolean; data_source?: { id: string; name: string } }>(`${base}/save-dataset`, {
      method: 'POST',
      body: JSON.stringify({ name, columns, rows, project_id: projectId || undefined }),
    }),
};

export function newCellId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** The next free result name like q1, q2 or df1 for a new cell. */
export function nextResultName(cells: NotebookCell[], prefix: string): string {
  const used = new Set(cells.map((c) => c.name).filter(Boolean));
  let i = 1;
  while (used.has(`${prefix}${i}`)) i += 1;
  return `${prefix}${i}`;
}
