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

const isEE = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

type UsageMetric = { used?: number; unlimited?: boolean; limit?: number; percentage?: number };

// Lazy reference to the EE store — populated once on first call when in EE edition.
// Using a lazy ref avoids conditional hook calls (hooks can't be called conditionally).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _eeStore: ((...args: any[]) => any) | null = null;

if (isEE) {
  try {
    // Direct require: EE module is bundled in EE edition.
    // CE builds never reach this branch (isEE=false) so tree-shaker eliminates it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _eeStore = require('@/ee').useSubscriptionStore;
  } catch {
    // Graceful fallback — EE module not available (CE build or missing submodule)
  }
}

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
 * Safe to call in any component — both stores are unconditionally called per render
 * cycle via the _eeStore reference set at module load time (constant, not state).
 */
export const useSubscriptionStore: () => ReturnType<typeof _ceStub> = _eeStore
  ? (_eeStore as () => ReturnType<typeof _ceStub>)
  : _ceStub;
