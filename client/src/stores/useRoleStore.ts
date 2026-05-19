/**
 * useRoleStore
 * Fetches and caches roles from /api/rbac/roles, split by scope.
 *
 * Usage:
 *   const { projectRoles, fetchProjectRoles } = useRoleStore();
 *   await fetchProjectRoles();   // loads project-scoped roles
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { fetchApi } from '@/utils/api';
import { Role, RoleScope } from '@/types/roles';

interface RoleState {
  /** All roles that have scope = "project" */
  projectRoles: Role[];
  /** All roles that have scope = "organization" */
  orgRoles: Role[];
  loading: boolean;
  error: string | null;

  /**
   * Fetch project-scoped roles from the server.
   * Caches the result — does not refetch if already populated (pass force=true to override).
   */
  fetchProjectRoles: (force?: boolean) => Promise<void>;

  /**
   * Fetch organization-scoped roles from the server.
   * Caches the result — does not refetch if already populated (pass force=true to override).
   */
  fetchOrgRoles: (force?: boolean) => Promise<void>;

  /**
   * Validate that a role_id belongs to the given scope.
   * Returns the matching Role or null.
   */
  validateRoleScope: (roleId: string, scope: RoleScope) => Role | null;

  reset: () => void;
}

export const useRoleStore = create<RoleState>()(
  devtools(
    (set, get) => ({
      projectRoles: [],
      orgRoles: [],
      loading: false,
      error: null,

      fetchProjectRoles: async (force = false) => {
        const { projectRoles } = get();
        if (!force && projectRoles.length > 0) return; // already cached

        set({ loading: true, error: null });
        try {
          // Server returns a plain list of Role objects
          const data: Role[] = await fetchApi('/rbac/roles?scope=project');
          set({ projectRoles: Array.isArray(data) ? data : [], loading: false });
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to fetch project roles';
          set({ loading: false, error: msg });
          console.error('useRoleStore: fetchProjectRoles error:', error);
        }
      },

      fetchOrgRoles: async (force = false) => {
        const { orgRoles } = get();
        if (!force && orgRoles.length > 0) return; // already cached

        set({ loading: true, error: null });
        try {
          const data: Role[] = await fetchApi('/rbac/roles?scope=organization');
          set({ orgRoles: Array.isArray(data) ? data : [], loading: false });
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Failed to fetch org roles';
          set({ loading: false, error: msg });
          console.error('useRoleStore: fetchOrgRoles error:', error);
        }
      },

      validateRoleScope: (roleId: string, scope: RoleScope): Role | null => {
        const { projectRoles, orgRoles } = get();
        const pool = scope === 'project' ? projectRoles : orgRoles;
        return pool.find((r) => r.id === roleId) ?? null;
      },

      reset: () => set({ projectRoles: [], orgRoles: [], loading: false, error: null }),
    }),
    { name: 'role-store' }
  )
);
