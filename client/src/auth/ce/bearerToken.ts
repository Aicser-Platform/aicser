const STORAGE_KEY = 'ce_api_bearer_token';

/** Persist CE JWT for `Authorization: Bearer` (same value as httpOnly auth_token). */
export function setCeBearerToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) sessionStorage.setItem(STORAGE_KEY, token);
  else sessionStorage.removeItem(STORAGE_KEY);
}

export function getCeBearerToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function clearCeBearerToken(): void {
  setCeBearerToken(null);
}
