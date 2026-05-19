/**
 * usePermissions Hook
 * 
 * React hook for checking user permissions in the frontend.
 * Provides permission checking based on user's roles in organizations and projects.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';

export enum Permission {
  // Organization permissions
  ORG_VIEW = 'org:view',
  ORG_EDIT = 'org:edit',
  ORG_DELETE = 'org:delete',
  ORG_MANAGE_USERS = 'org:manage_users',
  ORG_MANAGE_BILLING = 'org:manage_billing',
  ORG_VIEW_ANALYTICS = 'org:view_analytics',
  
  // Project permissions
  PROJECT_VIEW = 'project:view',
  PROJECT_EDIT = 'project:edit',
  PROJECT_DELETE = 'project:delete',
  PROJECT_MANAGE_MEMBERS = 'project:manage_members',
  PROJECT_EXPORT = 'project:export',
  
  // Data permissions
  DATA_VIEW = 'data:view',
  DATA_EDIT = 'data:edit',
  DATA_DELETE = 'data:delete',
  DATA_UPLOAD = 'data:upload',
  DATA_CONNECT = 'data:connect',
  
  // Chart/Dashboard permissions
  CHART_VIEW = 'chart:view',
  CHART_EDIT = 'chart:edit',
  CHART_DELETE = 'chart:delete',
  CHART_SHARE = 'chart:share',
  DASHBOARD_VIEW = 'dashboard:view',
  DASHBOARD_EDIT = 'dashboard:edit',
  DASHBOARD_DELETE = 'dashboard:delete',
  DASHBOARD_PUBLISH = 'dashboard:publish',
  
  // AI permissions
  AI_USE = 'ai:use',
  AI_ADVANCED = 'ai:advanced',
  AI_TRAIN_MODELS = 'ai:train_models',
  
  // Query permissions
  QUERY_EXECUTE = 'query:execute',
  QUERY_SAVE = 'query:save',
  QUERY_SHARE = 'query:share',
  
  // User permissions
  USER_VIEW_PROFILE = 'user:view_profile',
  USER_EDIT_PROFILE = 'user:edit_profile',
  USER_MANAGE_API_KEYS = 'user:manage_api_keys',
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
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Organization context removed - use provided organizationId or undefined
  const organizationId = useMemo(() => {
    return options.organizationId ? String(options.organizationId) : undefined;
  }, [options.organizationId]);

  const projectId = useMemo(() => {
    return options.projectId ? String(options.projectId) : undefined;
  }, [options.projectId]);

  const fetchPermissions = useCallback(async () => {
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
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch(`/api/rbac/permissions?${params.toString()}`, {
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
      const permissionValues = (data?.permissions || []).map((p: string) => p as Permission);
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
      return permissions.includes(permission);
    },
    [permissions]
  );

  const hasAnyPermission = useCallback(
    (permissionList: Permission[]): boolean => {
      return permissionList.some((perm) => permissions.includes(perm));
    },
    [permissions]
  );

  const hasAllPermissions = useCallback(
    (permissionList: Permission[]): boolean => {
      return permissionList.every((perm) => permissions.includes(perm));
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

