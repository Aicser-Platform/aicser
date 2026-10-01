import type { DashboardFilter } from '@/types/dashboard';
import type { RuntimeFilter } from './filterOperators';
import { isRelativeDatePreset } from './normalizeDashboardFilters';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * "Last 30 days" on data that ended last year shows an empty dashboard. When a date filter's
 * default is a relative window and the data's latest date falls before that window, the same
 * window is laid over the latest data instead ("the last 30 days of data"), with its real dates
 * shown in the filter. Data that is up to date is left exactly as it was.
 */
export async function anchorRelativeDateDefaults(
  filters: DashboardFilter[],
  defaults: RuntimeFilter[],
  latestDate: (filter: DashboardFilter) => Promise<string | null>,
): Promise<RuntimeFilter[]> {
  let next = defaults;
  for (const f of filters) {
    const raw = (f as { default?: unknown }).default;
    if (f.type !== 'dateRange' || !isRelativeDatePreset(raw)) continue;
    const from = next.find((r) => r.field === f.field && r.operator === '>=');
    const to = next.find((r) => r.field === f.field && r.operator === '<=');
    if (!from || !to || typeof from.value !== 'string' || typeof to.value !== 'string') continue;
    let latest: string | null = null;
    try {
      latest = await latestDate(f);
    } catch {
      latest = null;
    }
    const latestDay = latest ? new Date(String(latest).slice(0, 10) + 'T00:00:00Z') : null;
    const fromDay = new Date(from.value.slice(0, 10) + 'T00:00:00Z');
    const toDay = new Date(to.value.slice(0, 10) + 'T00:00:00Z');
    if (!latestDay || Number.isNaN(latestDay.getTime()) || latestDay >= fromDay) continue;
    const span = Math.max(0, toDay.getTime() - fromDay.getTime());
    const newTo = isoDay(latestDay);
    const newFrom = isoDay(new Date(latestDay.getTime() - span));
    next = next.map((r) =>
      r === from ? { ...r, value: newFrom } : r === to ? { ...r, value: newTo } : r,
    );
  }
  return next;
}
