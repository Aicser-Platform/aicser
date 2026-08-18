import { Permission, usePermissions } from '@/hooks/usePermissions';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';

/**
 * The permissions the server treats as "data admin".
 *
 * Mirrors DataSourceAccessService._is_org_data_admin, which grants edit, manage
 * and share on any source in the organization to holders of these. Keeping the
 * client in step avoids both dead buttons and actions hidden from people the
 * API would have allowed.
 */
export const DATA_ADMIN_PERMISSIONS = [
  Permission.DATA_DELETE,
  Permission.DATA_EDIT,
  Permission.DATA_CONNECT,
] as const;

export const computeCanManageDataAccess = (
  permissions: Permission[],
  { isEnterprise, loading }: { isEnterprise: boolean; loading: boolean }
): boolean => {
  // Grants and row filters are an EE concept; CE has neither to manage.
  if (loading || !isEnterprise) return false;
  return DATA_ADMIN_PERMISSIONS.some((permission) => permissions.includes(permission));
};

/** Whether the current user may manage access and row filters on data sources. */
export const useCanManageDataAccess = (): boolean => {
  const { permissions, loading } = usePermissions();
  return computeCanManageDataAccess(permissions, {
    isEnterprise: isEnterpriseEdition,
    loading,
  });
};
