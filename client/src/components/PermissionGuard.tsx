/**
 * PermissionGuard Component
 *
 * Conditionally renders children based on user permissions.
 * Useful for hiding/showing UI elements based on RBAC permissions.
 */

import React from 'react';
import { Alert, Button, Space, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { usePermissions } from '@/hooks/usePermissions';
import { Permission } from '@/constants/permissions';

export type { Permission };

export type PermissionDenyMode = 'hide' | 'explain';

interface PermissionGuardProps {
  permission: Permission | Permission[];
  organizationId?: string | number;
  projectId?: string | number;
  children: React.ReactNode;
  /**
   * Custom denied UI. When omitted:
   * - denyMode="hide" (default) → render nothing (correct for toolbar buttons)
   * - denyMode="explain" → Ask-admin empty state (correct for page/section shells)
   */
  fallback?: React.ReactNode;
  /** Shown while permissions are loading; defaults to `fallback` when set, otherwise null */
  loadingFallback?: React.ReactNode;
  requireAll?: boolean; // If true, requires ALL permissions; if false, requires ANY
  /**
   * hide: silent (default, backward-compatible for icon/button wraps).
   * explain: show why the surface is missing so users don't think the product is broken.
   */
  denyMode?: PermissionDenyMode;
}

/** Shared Ask-admin empty state — use via denyMode="explain" or as an explicit fallback. */
export function PermissionDeniedExplain({
  compact = false,
}: {
  compact?: boolean;
}) {
  const t = useTranslations('access_denied');
  const router = useRouter();
  return (
    <Alert
      type="warning"
      showIcon
      message={t('title')}
      description={
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text>{t('description')}</Typography.Text>
          {!compact ? (
            <Space wrap>
              <Button size="small" type="primary" onClick={() => router.push('/settings?tab=team')}>
                {t('contact_admin')}
              </Button>
              <Button size="small" onClick={() => router.push('/dashboards')}>
                {t('go_home')}
              </Button>
            </Space>
          ) : null}
        </Space>
      }
    />
  );
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
 *   permission={Permission.AI_USE}
 *   denyMode="explain"
 * >
 *   <BriefingsTab />
 * </PermissionGuard>
 * ```
 */
export const PermissionGuard: React.FC<PermissionGuardProps> = ({
  permission,
  organizationId,
  projectId,
  children,
  fallback,
  loadingFallback,
  requireAll = false,
  denyMode = 'hide',
}) => {
  const { hasPermission, hasAnyPermission, hasAllPermissions, loading } = usePermissions({
    organizationId,
    projectId,
    autoFetch: true,
  });

  const denied =
    fallback !== undefined ? (
      fallback
    ) : denyMode === 'explain' ? (
      <PermissionDeniedExplain />
    ) : null;

  if (loading) {
    const loader = loadingFallback ?? denied;
    return loader ? <>{loader}</> : null;
  }

  // Check single permission
  if (typeof permission === 'string') {
    return hasPermission(permission) ? <>{children}</> : <>{denied}</>;
  }

  // Check multiple permissions
  if (Array.isArray(permission)) {
    if (permission.length === 0) {
      return <>{children}</>; // No permissions required, show children
    }

    const hasAccess = requireAll
      ? hasAllPermissions(permission)
      : hasAnyPermission(permission);

    return hasAccess ? <>{children}</> : <>{denied}</>;
  }

  return <>{children}</>;
};

/**
 * usePermissionGuard Hook
 *
 * Returns a Guard component and permission helpers for imperative checks.
 */
export function usePermissionGuard() {
  return {
    Guard: PermissionGuard,
  };
}
