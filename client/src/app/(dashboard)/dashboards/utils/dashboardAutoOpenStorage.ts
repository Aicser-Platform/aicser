/** User preference: auto-open Dashboard Studio when AI starts building.
 * Default OFF so users stay in chat to see the live preview and refine. */

const STORAGE_KEY = 'aiser_dashboard_auto_open_studio';

export function isDashboardAutoOpenEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    // Explicit opt-in only (null → off)
    return v === '1';
  } catch {
    return false;
  }
}

export function setDashboardAutoOpenEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}
