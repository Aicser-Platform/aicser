/** The second sign-in step: a password or provider sign-in that still needs an authenticator code. */

import { setCeBearerToken } from '@/auth/ce/bearerToken';

const PENDING_KEY = 'aicser_two_factor_login';
export const TWO_FACTOR_EVENT = 'aicser-two-factor';

export class TwoFactorRequiredError extends Error {
  constructor(public readonly loginToken: string) {
    super('two_factor_required');
  }
}

export function pendingTwoFactor(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearPendingTwoFactor(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* unavailable storage just means signing in again */
  }
}

/** Keeps the token for the login page, which may only open after a redirect. */
export function rememberTwoFactor(loginToken: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, loginToken);
  } catch {
    /* the error thrown by the caller still reaches the login form */
  }
  window.dispatchEvent(new CustomEvent(TWO_FACTOR_EVENT));
}

export function raiseIfTwoFactor(data: { two_factor_required?: boolean; login_token?: string | null }): void {
  if (data.two_factor_required && data.login_token) {
    rememberTwoFactor(data.login_token);
    throw new TwoFactorRequiredError(data.login_token);
  }
}

export async function verifyTwoFactor(loginToken: string, entry: { code?: string; backup_code?: string }): Promise<void> {
  const res = await fetch('/api/auth/2fa/verify-login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_token: loginToken, ...entry }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; detail?: string };
  if (!res.ok) throw new Error(data.detail || 'verification_failed');
  if (data.access_token) setCeBearerToken(data.access_token);
  clearPendingTwoFactor();
}
