import { describe, expect, it, vi } from 'vitest';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));

import OnboardingRedirect from '../[sessionId]/page';

describe('old upload onboarding links', () => {
  it('land on Connections', () => {
    OnboardingRedirect();
    expect(redirect).toHaveBeenCalledWith('/data');
  });
});
