import type { AuthActions, SignupResult } from '@/auth/types';
import { supabase } from '@/auth/authClient';
import { setCeBearerToken, clearCeBearerToken } from '@/auth/ce/bearerToken';

async function exchangeSupabaseToken(accessToken: string): Promise<string | null> {
  const res = await fetch('/api/auth/token-exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'supabase', token: accessToken }),
    credentials: 'include',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail ?? 'Token exchange failed');
  }
  const data = (await res.json().catch(() => ({}))) as { access_token?: string };
  return data.access_token ?? null;
}

export const supabaseAuthActions: AuthActions = {
  async login(email: string, password: string): Promise<void> {
    if (!supabase) throw new Error('Supabase is not configured');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);

    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error('No session returned from Supabase');

    const ceToken = await exchangeSupabaseToken(accessToken);
    if (ceToken) setCeBearerToken(ceToken);
  },

  async signup(email: string, username: string, password: string): Promise<SignupResult> {
    if (!supabase) throw new Error('Supabase is not configured');

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    if (error) throw new Error(error.message);

    const accessToken = data.session?.access_token;
    if (accessToken) {
      const ceToken = await exchangeSupabaseToken(accessToken);
      if (ceToken) setCeBearerToken(ceToken);
    }

    const needsVerification = !data.session;
    return {
      success: true,
      is_verified: !needsVerification,
      message: needsVerification
        ? 'Check your email to confirm your account.'
        : 'Account created successfully!',
    };
  },

  async logout(): Promise<void> {
    clearCeBearerToken();
    if (supabase) await supabase.auth.signOut();
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  },
};
