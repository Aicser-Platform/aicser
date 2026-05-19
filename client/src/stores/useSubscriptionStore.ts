'use client';
import type { PricingPlanKey } from '@/utils/pricingPlans';

type UsageMetric = { used?: number; unlimited?: boolean; limit?: number; percentage?: number };

const noop = async () => {};
const noopOpts = async (_opts?: unknown) => {};

export const useSubscriptionStore = () => ({
  planType: 'free' as PricingPlanKey,
  subscription: null as Record<string, unknown> | null,
  usage: {} as Record<string, UsageMetric | undefined>,
  features: {} as Record<string, boolean>,
  loading: false,
  refresh: noop,
  refreshUsage: noopOpts,
  init: noop,
});
