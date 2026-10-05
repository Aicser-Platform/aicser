/**
 * Time left on the current plan, shared by the billing tab and the profile dropdown so
 * they never disagree. Takes the subscription object from GET /pricing/subscription.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type SubscriptionLike = {
  plan?: { slug?: string } | null;
  status?: string | null;
  provider?: string | null;
  is_trial?: boolean | null;
  trial_ends_at?: string | null;
  period_starts_at?: string | null;
  ends_at?: string | null;
} | null | undefined;

export type PlanRemaining = {
  /** Whole days left, rounded up; 0 on the last day. */
  daysLeft: number;
  end: Date;
  /** Length of the current term in days, when its start is known (for a progress bar). */
  termDays: number | null;
  /** Which end label applies: a trial ending, a Stripe plan renewing, or a plan ending. */
  kind: 'trial' | 'renews' | 'ends';
};

/** Null on Free, or when the plan has no end date. */
export function getPlanRemaining(subscription: SubscriptionLike, nowMs: number): PlanRemaining | null {
  if (!subscription || (subscription.plan?.slug || 'free') === 'free') return null;
  const isTrial = subscription.is_trial === true;
  const endIso = isTrial ? subscription.trial_ends_at : subscription.ends_at;
  if (!endIso) return null;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return null;

  const start = subscription.period_starts_at ? new Date(subscription.period_starts_at) : null;
  const termDays = start && end > start ? Math.ceil((end.getTime() - start.getTime()) / DAY_MS) : null;
  // Only a Stripe subscription that isn't canceled renews; trials, KHQR and canceled plans end.
  const renews = !isTrial && subscription.provider === 'stripe' && subscription.status !== 'canceled';

  return {
    daysLeft: Math.max(0, Math.ceil((end.getTime() - nowMs) / DAY_MS)),
    end,
    termDays,
    kind: isTrial ? 'trial' : renews ? 'renews' : 'ends',
  };
}
