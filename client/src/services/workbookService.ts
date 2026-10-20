import { fetchApi, fetchApiBlob } from '@/utils/api';

/** Data written into a sheet from a query (see server/src/modules/workbooks/schemas.py). */
export type DataRange = {
  id: string;
  name?: string | null;
  sheet: number;
  row: number;
  column: number;
  width: number;
  height: number;
  mode: 'live' | 'snapshot';
  data_source_id?: string | null;
  source_name?: string | null;
  sql?: string | null;
  refreshed_at?: string | null;
  row_count?: number | null;
  truncated?: boolean;
  pending?: boolean;
};

export type WorkbookSummary = {
  id: string;
  title: string;
  description?: string | null;
  visibility: 'private' | 'project';
  version: number;
  project_id: string | null;
  folder_id?: string | null;
  is_owner: boolean;
  size: number;
  range_count: number;
  locale: string;
  timezone: string;
  created_at: string | null;
  updated_at: string | null;
};

export type WorkbookParameterDef = {
  name: string;
  label?: string | null;
  type: 'string' | 'number' | 'boolean' | 'date';
  default?: unknown;
  required?: boolean;
};

export type WorkbookVisualEmbed = {
  id: string;
  kind: 'chart' | 'image';
  sheet_index: number;
  row: number;
  column: number;
  width: number;
  height: number;
  payload: Record<string, unknown>;
};

export type WorkbookSettings = {
  parameters: WorkbookParameterDef[];
  compute_profile: 'browser' | 'server';
  git: { remote_url?: string | null; branch?: string; last_export_at?: string | null; last_commit_message?: string | null; auto_export_on_save?: boolean };
  certification: {
    status: 'draft' | 'in_review' | 'approved' | 'rejected';
    submitted_by?: string | null;
    certified_by?: string | null;
    certified_at?: string | null;
    note?: string | null;
    locks_edits?: boolean;
  };
  visual_embeds?: WorkbookVisualEmbed[];
  analyze_bindings?: Array<{
    id: string;
    kind: 'pivot';
    sheet_index: number;
    row: number;
    column: number;
    width: number;
    height: number;
    analyze_binding: Record<string, unknown>;
  }>;
};

export type Workbook = WorkbookSummary & { doc: string; ranges: DataRange[]; settings?: WorkbookSettings };

export type WorkbookVersionSummary = {
  id: string;
  title: string;
  reason: 'created' | 'import' | 'save' | 'restore' | 'before_restore';
  workbook_version: number;
  size: number;
  is_me: boolean;
  created_at: string | null;
  updated_at: string | null;
};

const base = '/api/workbooks';
const enc = encodeURIComponent;

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(out);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

export const workbookService = {
  list: (projectId?: string | null) =>
    fetchApi<{ items: WorkbookSummary[] }>(`${base}${projectId ? `?project_id=${enc(projectId)}` : ''}`),
  get: (id: string) => fetchApi<Workbook>(`${base}/${enc(id)}`),
  create: (body: { title: string; project_id?: string | null; locale?: string; timezone?: string; ranges?: DataRange[] }) =>
    fetchApi<Workbook>(base, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: { title?: string; doc?: string; ranges?: DataRange[]; visibility?: 'private' | 'project'; version: number }) =>
    fetchApi<WorkbookSummary & { ranges: DataRange[] }>(`${base}/${enc(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string) => fetchApi<void>(`${base}/${enc(id)}`, { method: 'DELETE' }),
  restore: (id: string) => fetchApi<WorkbookSummary>(`${base}/${enc(id)}/restore`, { method: 'POST' }),
  duplicate: (id: string) => fetchApi<WorkbookSummary>(`${base}/${enc(id)}/duplicate`, { method: 'POST' }),
  importXlsx: (file: File, projectId?: string | null, locale?: string, timezone?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('title', file.name.replace(/\.xlsx$/i, ''));
    if (projectId) form.append('project_id', projectId);
    if (locale) form.append('locale', locale);
    if (timezone) form.append('timezone', timezone);
    return fetchApi<Workbook & { neutralized: number }>(`${base}/import`, { method: 'POST', body: form });
  },
  exportXlsx: (id: string) => fetchApiBlob(`${base}/${enc(id)}/export.xlsx`),
  syncDataSource: (id: string) =>
    fetchApi<{
      success: boolean;
      data_source_id: string;
      name: string;
      message: string;
      reused?: boolean;
      deduped_sources?: number;
    }>(
      `${base}/${enc(id)}/sync-datasource`,
      { method: 'POST' },
    ),
  getSettings: (id: string) => fetchApi<{ settings: WorkbookSettings }>(`${base}/${enc(id)}/settings`),
  putSettings: (id: string, patch: Partial<WorkbookSettings>) =>
    fetchApi<{ settings: WorkbookSettings }>(`${base}/${enc(id)}/settings`, { method: 'PUT', body: JSON.stringify(patch) }),
  lintSecrets: (id: string) =>
    fetchApi<{ findings: Array<{ message: string }>; ok: boolean }>(`${base}/${enc(id)}/lint-secrets`, { method: 'POST' }),
  audit: (id: string) => fetchApi<{ items: Array<{ action: string; created_at?: string }> }>(`${base}/${enc(id)}/audit`),
  gitExport: (id: string) => fetchApi<{ manifest: Record<string, unknown> }>(`${base}/${enc(id)}/git/export`, { method: 'POST' }),
  certifySubmit: (id: string) => fetchApi<{ settings: WorkbookSettings }>(`${base}/${enc(id)}/certification/submit`, { method: 'POST' }),
  certifyApprove: (id: string, body: { note?: string; lock_edits?: boolean }) =>
    fetchApi<{ settings: WorkbookSettings }>(`${base}/${enc(id)}/certification/approve`, { method: 'POST', body: JSON.stringify(body) }),
  certifyReject: (id: string, body: { note?: string }) =>
    fetchApi<{ settings: WorkbookSettings }>(`${base}/${enc(id)}/certification/reject`, { method: 'POST', body: JSON.stringify(body) }),
  versions: (id: string) => fetchApi<{ items: WorkbookVersionSummary[] }>(`${base}/${enc(id)}/versions`),
  version: (id: string, versionId: string) =>
    fetchApi<{ id: string; title: string; doc: string; ranges: DataRange[]; updated_at: string | null }>(`${base}/${enc(id)}/versions/${enc(versionId)}`),
  restoreVersion: (id: string, versionId: string) =>
    fetchApi<Workbook>(`${base}/${enc(id)}/versions/${enc(versionId)}/restore`, { method: 'POST' }),
};
