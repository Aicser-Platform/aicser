'use client';

/**
 * CE subscription store stub.
 *
 * In Community Edition: always returns planType='free' (no billing backend).
 * In Enterprise Edition: delegates to the real EE store which fetches from
 *   /api/billing/subscription — planType reflects the org's actual paid plan.
 *
 * All CE-codebase components import from this path; EE components may import
 * directly from @/ee for access to EE-only fields.
 */
import type { PricingPlanKey } from '@/utils/pricingPlans';
import { useSubscriptionStore as useEeSubscriptionStore } from '@/ee/stores/useSubscriptionStore';

const isEE = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

type UsageMetric = { used?: number; unlimited?: boolean; limit?: number; percentage?: number };

const noop = async () => {};
const noopOpts = async (_opts?: unknown) => {};
const noopMaxAge = async (_maxAgeMs?: number) => {};

const _ceStub = () => ({
  planType: 'free' as PricingPlanKey,
  subscription: null as Record<string, unknown> | null,
  usage: {} as Record<string, UsageMetric | undefined>,
  features: {} as Record<string, boolean>,
  loading: false,
  lastFetchedAt: null as number | null,
  refresh: noop,
  refreshUsage: noopOpts,
  init: noop,
  refreshIfStale: noopMaxAge,
});

/**
 * Hook: returns subscription state from EE store (in EE edition) or CE free stub.
 * `@/ee` is resolved by Next's CE/EE alias, so EE builds get the real billing
 * store and CE builds get the fallback without relying on browser-side require().
 */
export const useSubscriptionStore: () => ReturnType<typeof _ceStub> = isEE
  ? (useEeSubscriptionStore as () => ReturnType<typeof _ceStub>)
  : _ceStub;
