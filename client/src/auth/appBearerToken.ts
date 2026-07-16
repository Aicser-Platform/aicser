import { setCeBearerToken } from '@/auth/ce/bearerToken';

/**
 * Persist the backend Aicser JWT used by API calls.
 *
 * The original helper lives under `auth/ce` for historical reasons, but EE
 * token exchange and invite acceptance use the same application JWT.
 */
export function setAppBearerToken(token: string | null): void {
  setCeBearerToken(token);
}
