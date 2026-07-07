/**
 * A debounced layout-persist call must only fire against the dashboard that
 * was active when the layout change happened. react-grid-layout's own
 * "widget has no matching layout entry" fallback ({x:0, y:index, w:1, h:1})
 * can surface during a dashboard switch; without this guard, a save
 * scheduled before the switch fires 400ms later against whatever dashboard
 * is active *then*, silently persisting that stale/degenerate layout onto
 * real chart rows.
 */
export function shouldPersistLayoutSync(
  dashboardIdAtSchedule: string | null,
  activeDashboardIdAtFire: string | null
): boolean {
  return dashboardIdAtSchedule !== null && dashboardIdAtSchedule === activeDashboardIdAtFire;
}
