/** User preference: auto-open Dashboard Studio when AI starts building. */

const STORAGE_KEY = 'aiser_dashboard_auto_open_studio';

export function isDashboardAutoOpenEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null || v === '1';
  } catch {
    return true;
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
