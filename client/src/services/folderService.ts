/**
 * Project folders: one tree per project shared by every asset type (server: src/modules/folders).
 */
import { fetchApi } from '@/utils/api';

export type Folder = { id: string; name: string; parent_id: string | null; sort_order: number };
export type FolderAsset = 'notebook' | 'sheet' | 'saved_query' | 'model' | 'decision';

const base = '/api/folders';
const scope = (projectId?: string | null) => (projectId ? `?project_id=${encodeURIComponent(projectId)}` : '');

export const folderService = {
  list: (projectId?: string | null) => fetchApi<{ items: Folder[] }>(`${base}${scope(projectId)}`).then((r) => r.items || []),
  create: (name: string, projectId?: string | null, parentId?: string | null) =>
    fetchApi<Folder>(base, { method: 'POST', body: JSON.stringify({ name, project_id: projectId || null, parent_id: parentId || null }) }),
  rename: (id: string, name: string, projectId?: string | null) =>
    fetchApi<Folder>(`${base}/${encodeURIComponent(id)}${scope(projectId)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  remove: (id: string, projectId?: string | null) =>
    fetchApi<void>(`${base}/${encodeURIComponent(id)}${scope(projectId)}`, { method: 'DELETE' }),
  file: (assetType: FolderAsset, assetId: string, folderId: string | null, projectId?: string | null) =>
    fetchApi<{ folder_id: string | null }>(`${base}/file${scope(projectId)}`, {
      method: 'PUT',
      body: JSON.stringify({ asset_type: assetType, asset_id: assetId, folder_id: folderId }),
    }),
};

/** The folder and everything under it (to show a folder's items together with its subfolders'). */
export function folderAndDescendants(folders: Folder[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

export type FolderNode = { value: string; title: string; children?: FolderNode[] };

/** antd TreeSelect data for the folder tree. */
export function folderTree(folders: Folder[]): FolderNode[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const key = f.parent_id && folders.some((p) => p.id === f.parent_id) ? f.parent_id : null;
    byParent.set(key, [...(byParent.get(key) || []), f]);
  }
  const build = (parent: string | null): FolderNode[] =>
    (byParent.get(parent) || []).map((f) => {
      const children = build(f.id);
      return children.length ? { value: f.id, title: f.name, children } : { value: f.id, title: f.name };
    });
  return build(null);
}
