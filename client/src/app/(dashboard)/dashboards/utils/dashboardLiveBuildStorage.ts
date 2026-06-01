/** sessionStorage helpers for AI live dashboard builds in Studio. */

export const AI_BUILD_SESSION_KEY = 'aiser_ai_build_';

export function markDashboardLiveBuild(dashboardId: string): void {
  if (typeof window === 'undefined' || !dashboardId) return;
  try {
    sessionStorage.setItem(`${AI_BUILD_SESSION_KEY}${dashboardId}`, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function isDashboardLiveBuild(dashboardId: string): boolean {
  if (typeof window === 'undefined' || !dashboardId) return false;
  try {
    return Boolean(sessionStorage.getItem(`${AI_BUILD_SESSION_KEY}${dashboardId}`));
  } catch {
    return false;
  }
}

export function clearDashboardLiveBuild(dashboardId: string): void {
  if (typeof window === 'undefined' || !dashboardId) return;
  try {
    sessionStorage.removeItem(`${AI_BUILD_SESSION_KEY}${dashboardId}`);
  } catch {
    /* ignore */
  }
}
