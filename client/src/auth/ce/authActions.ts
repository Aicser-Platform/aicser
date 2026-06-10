import type { AuthActions, SignupResult } from '@/auth/types';
import { setCeBearerToken, clearCeBearerToken } from '@/auth/ce/bearerToken';
import { parseAuthResponseError } from '@/auth/parseAuthResponseError';

type AuthJson = {
  detail?: string | { message?: string };
  message?: string;
  error?: string;
  details?: Array<{ loc?: (string | number)[]; msg?: string }>;
  access_token?: string;
};

async function readAuthJson(res: Response): Promise<AuthJson> {
  try {
    return (await res.json()) as AuthJson;
  } catch {
    return {};
  }
}

export const ceAuthActions: AuthActions = {
  async login(email: string, password: string): Promise<void> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });
    const data = await readAuthJson(res);
    if (!res.ok) {
      throw new Error(parseAuthResponseError(res.status, data));
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
    const data = await readAuthJson(res);
    if (!res.ok) {
      throw new Error(parseAuthResponseError(res.status, data));
    }
    if (data.access_token) setCeBearerToken(data.access_token);
    return { success: true, is_verified: true, message: 'Account created successfully!' };
  },

  async logout(): Promise<void> {
    clearCeBearerToken();
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  },
};
