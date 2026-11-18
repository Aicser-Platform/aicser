'use client';

import React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useOrgMenu } from '@/hooks/useOrgMenu';
import { usePermissions } from '@/hooks/usePermissions';
import { Permission } from '@/constants/permissions';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';
import { isAiFrontendEnabled } from '@/utils/aiAvailability';
import {
  buildCommunitySidebarItems,
  buildEnterpriseSidebarItems,
  defaultFoldedSections,
  essentialSidebarItems,
  filterSidebarItems,
  openKeysForPathname,
  selectedKeyForPathname,
  type NavItemDef,
} from '@/layouts/Navigation/navConfig';

export const isEnterpriseEdition = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

const ALL_TOOLS_KEY = 'aicser.nav.allTools';

/** The current page's nav key (sidebar, tab bar and header crumb agree on it). */
export function useSelectedNavKey(): string {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ? `?${searchParams.toString()}` : null;
  return React.useMemo(() => selectedKeyForPathname(pathname, search), [pathname, search]);
}

/** Plan features: unknown (loading, CE) counts as on, so nothing flickers away. */
export function useHasFeature() {
  const { features, loading } = useSubscriptionStore();
  return React.useCallback(
    (feature: string) => {
      if (!isEnterpriseEdition) return true;
      if (loading || !features || Object.keys(features).length === 0) return true;
      const value = features[feature];
      return typeof value === 'boolean' ? value : true;
    },
    [features, loading]
  );
}

/**
 * Sidebar entries for this person: edition, plan, role and the organization's menu choices (Settings › Menu).
 * People who only view and ask start with the everyday pages ("Show all tools" a click away).
 */
export function useSidebarItems() {
  const pathname = usePathname();
  const hasFeature = useHasFeature();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const menu = useOrgMenu();
  const showAiNav = isEnterpriseEdition && isAiFrontendEnabled();

  const enterpriseItems = React.useMemo<NavItemDef[]>(
    () =>
      filterSidebarItems(buildEnterpriseSidebarItems(showAiNav), {
        hasFeature,
        hasPermission: permissionsLoading ? undefined : (code) => hasPermission(code as Permission),
        menu,
        isAdmin: hasPermission(Permission.ORG_EDIT),
      }),
    [showAiNav, hasFeature, hasPermission, permissionsLoading, menu]
  );
  const communityItems = React.useMemo(() => buildCommunitySidebarItems(), []);

  const canBuild = hasPermission(Permission.QUERY_SAVE) || hasPermission(Permission.CHART_EDIT);
  const canManageData = hasPermission(Permission.DATA_CONNECT) || hasPermission(Permission.ORG_EDIT);
  const defaultFolded = React.useMemo(
    () => (permissionsLoading ? [] : defaultFoldedSections({ canBuild, canManageData })),
    [permissionsLoading, canBuild, canManageData]
  );

  const viewsOnly = isEnterpriseEdition && !permissionsLoading && !canBuild && !canManageData;
  const [showAllTools, setShowAllTools] = React.useState(false);
  React.useEffect(() => {
    try {
      setShowAllTools(localStorage.getItem(ALL_TOOLS_KEY) === '1');
    } catch {
      // only a convenience
    }
  }, []);
  const toggleAllTools = React.useCallback(() => {
    setShowAllTools((value) => {
      try {
        localStorage.setItem(ALL_TOOLS_KEY, value ? '0' : '1');
      } catch {
        // only a convenience
      }
      return !value;
    });
  }, []);

  const routeOpenGroups = React.useMemo(() => openKeysForPathname(pathname), [pathname]);
  const essentialsOnly = viewsOnly && !showAllTools && routeOpenGroups.length === 0;
  const items = isEnterpriseEdition
    ? essentialsOnly
      ? essentialSidebarItems(enterpriseItems)
      : enterpriseItems
    : communityItems;

  return { items, defaultFolded, viewsOnly, essentialsOnly, toggleAllTools };
}
