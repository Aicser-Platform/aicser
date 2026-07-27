/**
 * Logout barrier — prevents concurrent token-exchange / init from minting a
 * new Aicser session while (or after) the user is signing out.
 *
 * Uses an in-memory flag for the logout window plus a sessionStorage sticky
 * flag so a leftover Supabase session cannot re-exchange after logout ends.
 * Cleared only on successful login/signup.
 */

const INTENTIONAL_LOGOUT_KEY = 'aicser_intentional_logout';

let logoutEpoch = 0;
let logoutInProgress = false;

function hasIntentionalLogoutFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(INTENTIONAL_LOGOUT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Call at the start of logout. Returns the epoch to pass to endLogout. */
export function beginLogout(): number {
  logoutInProgress = true;
  logoutEpoch += 1;
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(INTENTIONAL_LOGOUT_KEY, '1');
    } catch {
      /* ignore quota / private mode */
    }
  }
  return logoutEpoch;
}

/** Call when logout finishes (success or failure). Sticky flag remains until login. */
export function endLogout(epoch?: number): void {
  if (epoch !== undefined && epoch !== logoutEpoch) return;
  logoutInProgress = false;
}

/** Clear sticky logout flag — call after successful login/signup only. */
export function clearIntentionalLogout(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(INTENTIONAL_LOGOUT_KEY);
  } catch {
    /* ignore */
  }
}

export function getLogoutEpoch(): number {
  return logoutEpoch;
}

export function isLogoutInProgress(): boolean {
  return logoutInProgress;
}

/** True when an async auth write started under an older logout generation. */
export function isStaleLogoutEpoch(epochAtStart: number): boolean {
  return epochAtStart !== logoutEpoch;
}

/** Allow token exchange / bearer writes only when not logging out / post-logout. */
export function canAcceptAuthSession(): boolean {
  return !logoutInProgress && !hasIntentionalLogoutFlag();
}
