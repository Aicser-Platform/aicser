import type { StudioMode } from '../stores/useDashboardStore';

const KEY_PREFIX = 'dashboard_studio_mode_';

export function readStudioMode(dashboardId: string | null): StudioMode | null {
  if (typeof window === 'undefined' || !dashboardId) return null;
  try {
    const v = sessionStorage.getItem(`${KEY_PREFIX}${dashboardId}`);
    return v === 'view' || v === 'edit' ? v : null;
  } catch {
    return null;
  }
}

export function writeStudioMode(dashboardId: string | null, mode: StudioMode): void {
  if (typeof window === 'undefined' || !dashboardId) return;
  try {
    sessionStorage.setItem(`${KEY_PREFIX}${dashboardId}`, mode);
  } catch {
    /* ignore */
  }
}
