import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Project, ProjectMember } from '@/types/project';
import * as api from '@/api/projects';

interface ProjectUIState {
  currentProject: Project | null;
  currentProjectId: number | string | null;
  projects: Project[];
  loading: boolean;
  members: ProjectMember[];
  membersTotal: number;
  membersLoading: boolean;
  membersError: string | null;

  selectProject: (project: Project) => void;
  clearProject: () => void;
  loadProjects: (orgId: string | number) => Promise<void>;
  updateProject: (id: string | number, data: Partial<Project>) => Promise<void>;
  deleteProject: (id: string | number) => Promise<void>;
  listProjectMembers: (projectId: string) => Promise<void>;
  inviteUserToProject: (
    projectId: string,
    payload: { user_id?: string; email?: string; role_id: string }
  ) => Promise<boolean>;
  updateProjectMemberRole: (
    projectId: string,
    userId: string,
    roleId: string
  ) => Promise<boolean>;
  removeProjectMember: (projectId: string, userId: string) => Promise<void>;
}

export const useProjectStore = create<ProjectUIState>()(
  devtools(
    persist(
      (set, get) => ({
        currentProject: null,
        currentProjectId: null,
        projects: [],
        loading: false,
        members: [],
        membersTotal: 0,
        membersLoading: false,
        membersError: null,

        selectProject: (project) =>
          set({ currentProject: project, currentProjectId: project.id }),

        clearProject: () =>
          set({ currentProject: null, currentProjectId: null }),

        loadProjects: async (orgId) => {
          set({ loading: true });
          try {
            const res = await api.listProjects(String(orgId));
            set({ projects: res?.projects ?? [] });
          } finally {
            set({ loading: false });
          }
        },

        updateProject: async (id, data) => {
          const updated = await api.updateProject(id, data);
          set((s) => ({
            projects: s.projects.map((p) => (p.id === updated.id ? updated : p)),
            currentProject:
              s.currentProject?.id === updated.id ? updated : s.currentProject,
          }));
        },

        deleteProject: async (id) => {
          await api.deleteProject(id);
          set((s) => ({
            projects: s.projects.filter((p) => p.id !== String(id)),
            currentProject:
              s.currentProject?.id === String(id) ? null : s.currentProject,
            currentProjectId:
              s.currentProjectId === id || s.currentProjectId === String(id)
                ? null
                : s.currentProjectId,
          }));
        },

        listProjectMembers: async (projectId) => {
          set({ membersLoading: true, membersError: null });
          try {
            const res = await api.listProjectMembers(projectId);
            set({ members: res?.members ?? [], membersTotal: res?.total ?? 0 });
          } catch (e) {
            set({ membersError: e instanceof Error ? e.message : 'Failed to load members' });
          } finally {
            set({ membersLoading: false });
          }
        },

        inviteUserToProject: async (projectId, payload) => {
          try {
            await api.inviteProjectMember(projectId, payload);
            await get().listProjectMembers(projectId);
            return true;
          } catch (e) {
            set({ membersError: e instanceof Error ? e.message : 'Failed to invite member' });
            return false;
          }
        },

        updateProjectMemberRole: async (projectId, userId, roleId) => {
          await api.updateProjectMemberRole(projectId, userId, roleId);
          await get().listProjectMembers(projectId);
          return true;
        },

        removeProjectMember: async (projectId, userId) => {
          await api.removeProjectMember(projectId, userId);
          set((s) => ({
            members: s.members.filter((m) => m.user_id !== userId),
            membersTotal: Math.max(0, s.membersTotal - 1),
          }));
        },
      }),
      {
        name: 'project-storage',
        partialize: (state) => ({
          currentProjectId: state.currentProjectId,
          currentProject: state.currentProject,
        }),
      }
    ),
    { name: 'ProjectStore' }
  )
);
