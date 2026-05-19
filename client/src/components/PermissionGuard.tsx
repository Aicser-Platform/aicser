/**
 * PermissionGuard Component
 * 
 * Conditionally renders children based on user permissions.
 * Useful for hiding/showing UI elements based on RBAC permissions.
 */

import React from 'react';
import { usePermissions, Permission } from '@/hooks/usePermissions';

interface PermissionGuardProps {
  permission: Permission | Permission[];
  organizationId?: string | number;
  projectId?: string | number;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  requireAll?: boolean; // If true, requires ALL permissions; if false, requires ANY
}

/**
 * PermissionGuard - Conditionally renders children based on permissions
 * 
 * @example
 * ```tsx
 * <PermissionGuard permission={Permission.PROJECT_EDIT}>
 *   <EditButton />
 * </PermissionGuard>
 * 
 * <PermissionGuard 
 *   permission={[Permission.PROJECT_EDIT, Permission.PROJECT_DELETE]}
 *   requireAll={false}
 *   fallback={<div>No access</div>}
 * >
 *   <ActionButtons />
 * </PermissionGuard>
 * ```
 */
export const PermissionGuard: React.FC<PermissionGuardProps> = ({
  permission,
  organizationId,
  projectId,
  children,
  fallback = null,
  requireAll = false,
}) => {
  const { hasPermission, hasAnyPermission, hasAllPermissions, loading } = usePermissions({
    organizationId,
    projectId,
    autoFetch: true,
  });

  // Show nothing while loading (fail secure)
  if (loading) {
    return null;
  }

  // Check single permission
  if (typeof permission === 'string') {
    return hasPermission(permission) ? <>{children}</> : <>{fallback}</>;
  }

  // Check multiple permissions
  if (Array.isArray(permission)) {
    if (permission.length === 0) {
      return <>{children}</>; // No permissions required, show children
    }

    const hasAccess = requireAll
      ? hasAllPermissions(permission)
      : hasAnyPermission(permission);

    return hasAccess ? <>{children}</> : <>{fallback}</>;
  }

  // Fallback: show nothing if permission is invalid
  return null;
};

/**
 * usePermissionGuard Hook
 * 
 * Returns a component that conditionally renders based on permissions.
 * Useful for inline permission checks.
 */
export function usePermissionGuard() {
  return {
    Guard: PermissionGuard,
  };
}



