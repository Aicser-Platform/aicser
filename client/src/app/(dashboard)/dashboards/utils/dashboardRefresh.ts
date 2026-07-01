export const DEFAULT_AUTO_REFRESH_MINUTES = 5;
export const DEFAULT_REFRESH_CONCURRENCY = 4;

export type RefreshResult = { ok: number; failed: number; total: number };

export function isDataWidget(widget: {
  chartType?: string;
  chartId?: string;
  dataSourceId?: string | null;
}): boolean {
  if (!widget.chartId || !widget.dataSourceId) return false;
  return widget.chartType !== 'text' && widget.chartType !== 'slicer' && widget.chartType !== 'filter';
}

/** Run async tasks with a fixed concurrency limit (smooths DB connection spikes on refresh). */
export async function runWithConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency = DEFAULT_REFRESH_CONCURRENCY
): Promise<void> {
  if (!items.length) return;
  let index = 0;
  const limit = Math.min(Math.max(1, concurrency), items.length);
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await fn(items[current]);
    }
  });
  await Promise.all(workers);
}

export function formatLastRefreshed(
  date: Date | null,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  if (!date) return t('refresh_never');
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return t('refresh_just_now');
  if (diffMs < 3_600_000) return t('refresh_minutes_ago', { count: Math.floor(diffMs / 60_000) });
  if (diffMs < 86_400_000) return t('refresh_hours_ago', { count: Math.floor(diffMs / 3_600_000) });
  return t('refresh_days_ago', { count: Math.floor(diffMs / 86_400_000) });
}
