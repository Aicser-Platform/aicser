import { describe, expect, it } from 'vitest';
import { AUTO_TITLE_KEY, autoTitlePatch, deriveAutoTitle, fieldPhrase, isAutoTitle, displayTitle } from '../widgetAutoTitle';
import { preserveChartQueryOnTypeChange } from '../chartTypeMappingPreserve';

const MESSAGES: Record<string, string> = {
  auto_title_sum: 'Total {field}',
  auto_title_avg: 'Average {field}',
  auto_title_count: 'Count of {field}',
  auto_title_by: '{metric} by {dimension}',
};
const t = (key: string, values: Record<string, string> = {}) =>
  (MESSAGES[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

const bound = { tableName: 'orders', x: 'store_id', yMetrics: [{ field: 'order_total', aggregation: 'sum' }] };

describe('widgetAutoTitle', () => {
  it('names a field in words; a trailing id/key names the thing', () => {
    expect(fieldPhrase('order_total')).toBe('order total');
    expect(fieldPhrase('orders.store_id')).toBe('store');
  });

  it('derives a title from the data', () => {
    expect(deriveAutoTitle({ chartType: 'bar', chartQuery: bound }, t)).toBe('Total order total by store');
    expect(deriveAutoTitle({ chartType: 'stat', chartQuery: bound }, t)).toBe('Total order total');
    expect(deriveAutoTitle({ chartType: 'bar', chartQuery: {} }, t)).toBeNull();
  });

  it('treats placeholders and titles we wrote as automatic, never a typed one', () => {
    expect(isAutoTitle({ title: 'KPI' }, ['KPI'])).toBe(true);
    expect(isAutoTitle({ title: 'Line' })).toBe(true);
    expect(isAutoTitle({ title: 'Sales', chartOptions: { [AUTO_TITLE_KEY]: 'Sales' } })).toBe(true);
    expect(isAutoTitle({ title: 'Q3 store revenue' })).toBe(false);
  });

  it('never leaves a pie titled "KPI"', () => {
    const prev = { title: 'KPI', chartType: 'stat', chartQuery: bound };
    const patch = autoTitlePatch(prev, { ...prev, chartType: 'pie' }, t, ['KPI']);
    expect(patch?.title).toBe('Total order total by store');
    expect(patch?.chartOptions[AUTO_TITLE_KEY]).toBe('Total order total by store');
  });

  it('renames an unbound placeholder to the new type', () => {
    const prev = { title: 'Line', chartType: 'line', chartQuery: {} };
    expect(autoTitlePatch(prev, { ...prev, chartType: 'bar' }, t)?.title).toBe('Bar');
  });

  it("leaves a user's own title alone", () => {
    const prev = { title: 'Q3 store revenue', chartType: 'bar', chartQuery: bound };
    expect(autoTitlePatch(prev, { ...prev, chartType: 'pie' }, t)).toBeNull();
  });
});


describe('switching to a pie', () => {
  it('orders slices largest first unless a sort was chosen', () => {
    const w = { id: 'w', chartType: 'bar', chartQuery: { x: 'store', sortBy: 'x' } } as never;
    expect(preserveChartQueryOnTypeChange(w, 'pie')).toMatchObject({ sortBy: 'y', sortOrder: 'desc' });
    const chosen = { id: 'w', chartType: 'bar', chartQuery: { x: 'store', sortBy: 'x', sortOrder: 'asc' } } as never;
    expect(preserveChartQueryOnTypeChange(chosen, 'pie')).toMatchObject({ sortBy: 'x', sortOrder: 'asc' });
  });
});

describe('displayTitle', () => {
  const tp = (key: string, values: Record<string, string> = {}) =>
    (key === 'story_slot_kpi' ? 'KPI' : key === 'story_slot_trend' ? 'Tendance' : t(key, values));

  it('shows the data title for a placeholder, including a translated slot name', () => {
    expect(displayTitle({ title: 'KPI', chartType: 'pie', chartQuery: bound }, tp)).toBe('Total order total by store');
    expect(displayTitle({ title: 'Tendance', chartType: 'stat', chartQuery: bound }, tp)).toBe('Total order total');
  });

  it('keeps a typed title, and a placeholder with no data behind it', () => {
    expect(displayTitle({ title: 'Store sales', chartType: 'bar', chartQuery: bound }, tp)).toBe('Store sales');
    expect(displayTitle({ title: 'KPI', chartType: 'stat', chartQuery: {} }, tp)).toBe('KPI');
  });
});
