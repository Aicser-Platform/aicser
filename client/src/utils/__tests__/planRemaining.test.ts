import { describe, expect, it } from 'vitest';
import { getPlanRemaining } from '../planRemaining';

const NOW = Date.UTC(2026, 9, 5, 12);
const iso = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h)).toISOString();

describe('getPlanRemaining', () => {
  it('counts whole days left, rounding up, for a KHQR plan that ends', () => {
    const r = getPlanRemaining(
      { plan: { slug: 'team' }, status: 'active', provider: 'khqr', ends_at: iso(2026, 11, 5, 0), period_starts_at: iso(2026, 10, 5) },
      NOW,
    );
    expect(r?.daysLeft).toBe(31);
    expect(r?.kind).toBe('ends');
    expect(r?.termDays).toBe(31);
  });

  it('renews only for an active Stripe subscription', () => {
    const base = { plan: { slug: 'pro' }, provider: 'stripe', ends_at: iso(2026, 11, 1) };
    expect(getPlanRemaining({ ...base, status: 'active' }, NOW)?.kind).toBe('renews');
    expect(getPlanRemaining({ ...base, status: 'canceled' }, NOW)?.kind).toBe('ends');
  });

  it('uses the trial end on a trial', () => {
    const r = getPlanRemaining(
      { plan: { slug: 'team' }, status: 'trialing', provider: 'internal', is_trial: true, trial_ends_at: iso(2026, 10, 19, 12), ends_at: null },
      NOW,
    );
    expect(r?.kind).toBe('trial');
    expect(r?.daysLeft).toBe(14);
  });

  it('shows nothing on Free, without an end date, or with no subscription', () => {
    expect(getPlanRemaining({ plan: { slug: 'free' }, ends_at: iso(2026, 11, 1) }, NOW)).toBeNull();
    expect(getPlanRemaining({ plan: { slug: 'team' }, provider: 'internal', ends_at: null }, NOW)).toBeNull();
    expect(getPlanRemaining(null, NOW)).toBeNull();
  });

  it('never goes below zero once the end has passed', () => {
    expect(getPlanRemaining({ plan: { slug: 'pro' }, provider: 'khqr', ends_at: iso(2026, 10, 1) }, NOW)?.daysLeft).toBe(0);
  });
});
