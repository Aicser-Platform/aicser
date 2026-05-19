import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/auth/ce/authActions', () => ({
  ceAuthActions: { login: vi.fn(), signup: vi.fn(), logout: vi.fn(), _source: 'ce' },
}));

vi.mock('@/ee', () => ({
  eeAuthActions: { login: vi.fn(), signup: vi.fn(), logout: vi.fn(), _source: 'ee' },
}));

describe('getAuthActions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns ceAuthActions when NEXT_PUBLIC_EDITION is not "EE"', async () => {
    vi.stubEnv('NEXT_PUBLIC_EDITION', '');
    const { getAuthActions } = await import('@/auth/authProvider');
    const { ceAuthActions } = await import('@/auth/ce/authActions');
    expect(getAuthActions()).toBe(ceAuthActions);
  });

  it('returns eeAuthActions when NEXT_PUBLIC_EDITION is "EE"', async () => {
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
    const { getAuthActions } = await import('@/auth/authProvider');
    const { eeAuthActions } = await import('@/ee');
    expect(getAuthActions()).toBe(eeAuthActions);
  });
});
