import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    signInWithOAuth: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('@/ee/auth/authClient', () => ({
  supabase: supabaseMock,
}));

vi.mock('@/auth/ce/bearerToken', () => ({
  setCeBearerToken: vi.fn(),
  clearCeBearerToken: vi.fn(),
}));

describe('supabase auth actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/login');
  });

  it('accepts an explicit Supabase callback after an intentional logout in the same tab', async () => {
    const { beginLogout, endLogout, canAcceptAuthSession } = await import('@/auth/logoutBarrier');
    endLogout(beginLogout());
    expect(canAcceptAuthSession()).toBe(false);

    window.history.replaceState({}, '', '/login?code=provider-code');
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'supabase-token' } },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'aicser-token' }),
      }),
    );

    const { completeSupabaseRedirectSession } = await import('@/ee/auth/supabaseAuthActions');
    const { setCeBearerToken } = await import('@/auth/ce/bearerToken');

    await expect(completeSupabaseRedirectSession()).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith('/api/auth/token-exchange', expect.any(Object));
    expect(setCeBearerToken).toHaveBeenCalledWith('aicser-token');
    expect(canAcceptAuthSession()).toBe(true);
  });
});
