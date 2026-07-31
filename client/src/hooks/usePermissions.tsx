/**
 * usePermissions Hook
 * 
 * React hook for checking user permissions in the frontend.
 * Provides permission checking based on user's roles in organizations and projects.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { getCeBearerToken } from '@/auth/ce/bearerToken';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';

export { Permission } from '@/constants/permissions';
import { Permission } from '@/constants/permissions';

const IS_EE = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || process.env.EDITION || '').toLowerCase()
);
const CE_PERMISSIONS = Object.values(Permission);

function permissionListIncludes(permissions: string[], permission: Permission): boolean {
  if (permissions.includes(permission) || permissions.includes('*')) {
    return true;
  }
  const [resource] = permission.split(':');
  return permissions.includes(`${resource}:*`);
}

interface UsePermissionsOptions {
  organizationId?: string | number;
  projectId?: string | number;
  autoFetch?: boolean;
}

interface UsePermissionsReturn {
  permissions: Permission[];
  hasPermission: (permission: Permission) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;
  hasAllPermissions: (permissions: Permission[]) => boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to check user permissions
 * 
 * @param options - Options for permission checking
 * @returns Permission checking functions and state
 * 
 * @example
 * ```tsx
 * const { hasPermission, loading } = usePermissions({ organizationId: '1' });
 * 
 * if (hasPermission(Permission.PROJECT_EDIT)) {
 *   return <EditButton />;
 * }
 * ```
 */
export function usePermissions(options: UsePermissionsOptions = {}): UsePermissionsReturn {
  const { user, isAuthenticated, session } = useAuth();
  const currentOrganization = useOrganizationStore((s) => s.currentOrganization);
  const currentProject = useProjectStore((s) => s.currentProject);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const organizationId = useMemo(() => {
    if (options.organizationId != null) return String(options.organizationId);
    return currentOrganization?.id != null ? String(currentOrganization.id) : undefined;
  }, [options.organizationId, currentOrganization?.id]);

  const projectId = useMemo(() => {
    if (options.projectId != null) return String(options.projectId);
    return currentProject?.id != null ? String(currentProject.id) : undefined;
  }, [options.projectId, currentProject?.id]);

  const fetchPermissions = useCallback(async () => {
    if (!IS_EE) {
      setPermissions(CE_PERMISSIONS);
      setLoading(false);
      setError(null);
      return;
    }

    if (!isAuthenticated || !user) {
      setPermissions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (organizationId) {
        params.append('organization_id', organizationId);
      }
      if (projectId) {
        params.append('project_id', projectId);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const bearer = session?.access_token || getCeBearerToken();
      if (bearer) {
        headers['Authorization'] = `Bearer ${bearer}`;
      }

      const response = await fetch(`/api/rbac/me/permissions?${params.toString()}`, {
        cache: 'no-store',
        method: 'GET',
        credentials: 'include',
        headers,
      });

      if (!response.ok) {
        if (response.status === 401) {
          setError('Authentication required');
          setPermissions([]);
          return;
        }
        if (response.status === 403) {
          setError('Permission denied');
          setPermissions([]);
          return;
        }
        throw new Error(`Failed to fetch permissions: ${response.status}`);
      }

      const data = await response.json();
      const permissionValues = (Array.isArray(data?.permissions) ? data.permissions : []).map(
        (p: string) => p as Permission
      );
      setPermissions(permissionValues);
    } catch (err) {
      console.error('Error fetching permissions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch permissions');
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user, session, organizationId, projectId]);

  useEffect(() => {
    if (options.autoFetch !== false && isAuthenticated && user) {
      fetchPermissions();
    } else {
      setLoading(false);
    }
  }, [fetchPermissions, options.autoFetch, isAuthenticated, user]);

  const hasPermission = useCallback(
    (permission: Permission): boolean => {
      return permissionListIncludes(permissions, permission);
    },
    [permissions]
  );

  const hasAnyPermission = useCallback(
    (permissionList: Permission[]): boolean => {
      return permissionList.some((perm) => permissionListIncludes(permissions, perm));
    },
    [permissions]
  );

  const hasAllPermissions = useCallback(
    (permissionList: Permission[]): boolean => {
      return permissionList.every((perm) => permissionListIncludes(permissions, perm));
    },
    [permissions]
  );

  return {
    permissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    loading,
    error,
    refetch: fetchPermissions,
  };
}

/**
 * Hook to check a single permission (simplified version)
 * 
 * @param permission - Permission to check
 * @param options - Options for permission checking
 * @returns Boolean indicating if user has permission
 * 
 * @example
 * ```tsx
 * const canEdit = useHasPermission(Permission.PROJECT_EDIT, { organizationId: '1' });
 * ```
 */
export function useHasPermission(
  permission: Permission,
  options: UsePermissionsOptions = {}
): boolean {
  const { hasPermission, loading } = usePermissions(options);
  
  if (loading) {
    return false; // Default to false while loading (fail secure)
  }
  
  return hasPermission(permission);
}
