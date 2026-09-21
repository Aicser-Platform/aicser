'use client';

import React, { useCallback } from 'react';
import type { PricingPlanKey } from '@/utils/pricingPlans';

import { isSelfHostDeploymentFromEnv } from '@/utils/deploymentMode';

/**
 * Community / open-source: no billing integration — all plan gates open.
 * Shared CE components import this path. EE-only screens import `@/ee/hooks/usePlanRestrictions`.
 */
export function usePlanRestrictions() {
  const showUpgradePrompt = useCallback((_feature: string, _message?: string) => {}, []);

  const UpgradeModal = useCallback(() => null as React.ReactElement | null, []);

  const hasFeature = useCallback((_feature: string) => true, []);
  const canPerformAction = useCallback(
    (_action: 'create_project' | 'create_data_source' | 'generate_chart') => true,
    [],
  );
  const getRequiredPlan = useCallback((_feature: string) => 'Pro', []);

  const isSelfHost = isSelfHostDeploymentFromEnv();

  return {
    // In self-hosted mode, full enterprise capabilities are available.
    planType: (isSelfHost ? 'enterprise' : 'free') as PricingPlanKey,
    loading: false,
    hasFeature,
    canPerformAction,
    getRequiredPlan,
    showUpgradePrompt,
    UpgradeModal,
    isFreePlan: !isSelfHost,
    canUseFeature: hasFeature,
  };
}

