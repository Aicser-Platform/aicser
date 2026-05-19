import type { AuthActions, SignupResult } from '@/auth/types';
import { setCeBearerToken, clearCeBearerToken } from '@/auth/ce/bearerToken';

export const ceAuthActions: AuthActions = {
  async login(email: string, password: string): Promise<void> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });
    const data = (await res.json().catch(() => ({}))) as { detail?: string; access_token?: string };
    if (!res.ok) {
      throw new Error(data.detail ?? 'Invalid email or password');
    }
    if (data.access_token) setCeBearerToken(data.access_token);
  },

  async signup(email: string, username: string, password: string): Promise<SignupResult> {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password }),
      credentials: 'include',
    });
    const data = (await res.json().catch(() => ({}))) as { detail?: string; access_token?: string };
    if (!res.ok) {
      throw new Error(data.detail ?? 'Registration failed');
    }
    if (data.access_token) setCeBearerToken(data.access_token);
    return { success: true, is_verified: true, message: 'Account created successfully!' };
  },

  async logout(): Promise<void> {
    clearCeBearerToken();
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  },
};
