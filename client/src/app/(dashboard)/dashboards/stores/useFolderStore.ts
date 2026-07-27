'use client';

/**
 * Dashboard collections store — server-backed (dashboard_collections),
 * mirrors Chart Designer collections. Hydrates on demand; persists via API.
 */

import { create } from 'zustand';
import { dashboardLibraryService } from '../services/dashboardLibraryService';
import { useProjectStore } from '@/stores/useProjectStore';

export interface DashboardFolder {
  id: string;
  name: string;
  createdAt: number;
  collapsed?: boolean;
}

interface FolderState {
  folders: DashboardFolder[];
  /** dashboardId → collectionId */
  assignments: Record<string, string>;
  collapsedFolderIds: Set<string>;
  hydrated: boolean;
  hydrating: boolean;

  hydrate: (projectId?: string | number | null) => Promise<void>;
  createFolder: (name: string) => Promise<string>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  toggleCollapse: (id: string) => void;
  assignDashboard: (dashboardId: string, folderId: string | null) => Promise<void>;
  getFolderForDashboard: (dashboardId: string) => string | null;
}

function projectId(): string | number | null {
  return useProjectStore.getState().currentProjectId;
}

export const useFolderStore = create<FolderState>()((set, get) => ({
  folders: [],
  assignments: {},
  collapsedFolderIds: new Set(),
  hydrated: false,
  hydrating: false,

  hydrate: async (explicitProjectId) => {
    if (get().hydrating) return;
    set({ hydrating: true });
    try {
      const pid = explicitProjectId ?? projectId();
      const collections = await dashboardLibraryService.listCollections(pid);
      // Assignments come from dashboard list (summary) — first pages are enough for tab navigator
      const page = await dashboardLibraryService.list({
        projectId: pid,
        facet: 'all',
        limit: 200,
        offset: 0,
        detail: 'summary',
      });
      const assignments: Record<string, string> = {};
      for (const d of page.dashboards) {
        if (d.collectionId) assignments[String(d.id)] = String(d.collectionId);
      }
      set({
        folders: collections.map((c) => ({
          id: c.id,
          name: c.name,
          createdAt: Date.now(),
        })),
        assignments,
        hydrated: true,
      });
    } catch (err) {
      console.error('[useFolderStore.hydrate]', err);
      set({ folders: [], assignments: {}, hydrated: true });
    } finally {
      set({ hydrating: false });
    }
  },

  createFolder: async (name) => {
    const created = await dashboardLibraryService.createCollection(
      name.trim() || 'New Folder',
      projectId(),
    );
    set((s) => ({
      folders: [
        ...s.folders,
        { id: created.id, name: created.name, createdAt: Date.now() },
      ],
    }));
    return created.id;
  },

  renameFolder: async (id, name) => {
    const nextName = name.trim();
    if (!nextName) return;
    await dashboardLibraryService.renameCollection(id, nextName, projectId());
    set((s) => ({
      folders: s.folders.map((f) => (f.id === id ? { ...f, name: nextName } : f)),
    }));
  },

  deleteFolder: async (id) => {
    await dashboardLibraryService.deleteCollection(id, projectId());
    set((s) => {
      const nextAssignments = { ...s.assignments };
      Object.entries(nextAssignments).forEach(([dashId, fid]) => {
        if (fid === id) delete nextAssignments[dashId];
      });
      return {
        folders: s.folders.filter((f) => f.id !== id),
        assignments: nextAssignments,
      };
    });
  },

  toggleCollapse: (id) => {
    set((s) => {
      const next = new Set(s.collapsedFolderIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { collapsedFolderIds: next };
    });
  },

  assignDashboard: async (dashboardId, folderId) => {
    await dashboardLibraryService.assignCollection(dashboardId, folderId);
    set((s) => {
      const next = { ...s.assignments };
      if (folderId) next[dashboardId] = folderId;
      else delete next[dashboardId];
      return { assignments: next };
    });
  },

  getFolderForDashboard: (dashboardId) => {
    return get().assignments[dashboardId] ?? null;
  },
}));
