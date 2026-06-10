'use client';

import { useMemo } from 'react';
import { useOrganizationStore } from '@/stores/useOrganizationStore';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

const COLLAB_PLANS = new Set(['team', 'enterprise']);

/**
 * EE plan gate for live dashboard collaboration.
 * CE builds always return false; EE allows team+ plans (defaults open when org unset in dev).
 */
export function useCollaborationFeatureEnabled(): boolean {
  const org = useOrganizationStore((s) => s.currentOrganization);

  return useMemo(() => {
    if (!isEnterpriseEdition) return false;
    if (!org) return true;
    const plan = String((org as { plan_type?: string }).plan_type || 'team').toLowerCase();
    return COLLAB_PLANS.has(plan);
  }, [org]);
}

export function useDashboardCollaborationRoom(
  dashboardId: string | null | undefined,
  isEditMode: boolean,
): string {
  const featureEnabled = useCollaborationFeatureEnabled();
  if (!featureEnabled || !isEditMode || !dashboardId) return '';
  return String(dashboardId);
}
