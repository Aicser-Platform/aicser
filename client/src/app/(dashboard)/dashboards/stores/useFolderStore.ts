'use client';

/**
 * useFolderStore — lightweight client-side folder hierarchy for dashboards.
 *
 * Folders are stored in localStorage (no backend schema change needed).
 * A folder-assignment map tracks which dashboard belongs to which folder.
 * Unassigned dashboards float at the root level.
 */

import { create } from 'zustand';

export interface DashboardFolder {
  id: string;
  name: string;
  createdAt: number;
  /** Collapse state is also local */
  collapsed?: boolean;
}

const FOLDERS_KEY = 'aicser_dashboard_folders';
const ASSIGNMENTS_KEY = 'aicser_dashboard_folder_assignments';

function loadFolders(): DashboardFolder[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadAssignments(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(ASSIGNMENTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveFolders(folders: DashboardFolder[]) {
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); } catch {}
}

function saveAssignments(assignments: Record<string, string>) {
  try { localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments)); } catch {}
}

interface FolderState {
  folders: DashboardFolder[];
  /** dashboardId → folderId */
  assignments: Record<string, string>;
  /** locally collapsed folder ids */
  collapsedFolderIds: Set<string>;

  createFolder: (name: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  toggleCollapse: (id: string) => void;
  assignDashboard: (dashboardId: string, folderId: string | null) => void;
  getFolderForDashboard: (dashboardId: string) => string | null;
}

export const useFolderStore = create<FolderState>()((set, get) => ({
  folders: loadFolders(),
  assignments: loadAssignments(),
  collapsedFolderIds: new Set<string>(),

  createFolder: (name) => {
    const id = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const folder: DashboardFolder = { id, name: name.trim() || 'New Folder', createdAt: Date.now() };
    set((s) => {
      const next = [...s.folders, folder];
      saveFolders(next);
      return { folders: next };
    });
    return id;
  },

  renameFolder: (id, name) => {
    set((s) => {
      const next = s.folders.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f));
      saveFolders(next);
      return { folders: next };
    });
  },

  deleteFolder: (id) => {
    set((s) => {
      // unassign all dashboards from this folder
      const nextAssignments = { ...s.assignments };
      Object.entries(nextAssignments).forEach(([dashId, fid]) => {
        if (fid === id) delete nextAssignments[dashId];
      });
      const nextFolders = s.folders.filter((f) => f.id !== id);
      saveFolders(nextFolders);
      saveAssignments(nextAssignments);
      return { folders: nextFolders, assignments: nextAssignments };
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

  assignDashboard: (dashboardId, folderId) => {
    set((s) => {
      const next = { ...s.assignments };
      if (folderId) next[dashboardId] = folderId;
      else delete next[dashboardId];
      saveAssignments(next);
      return { assignments: next };
    });
  },

  getFolderForDashboard: (dashboardId) => {
    return get().assignments[dashboardId] ?? null;
  },
}));
