import { describe, expect, it } from 'vitest';
import { getWidgetSetupIssues, isWidgetSetupComplete } from '../widgetSetupStatus';
import type { WidgetInstance } from '../../stores/dashboardStoreTypes';

function widget(overrides: Partial<WidgetInstance> & Pick<WidgetInstance, 'chartType'>): WidgetInstance {
  return {
    id: 'w1',
    title: 'Widget',
    dataSourceId: 'ds-1',
    ...overrides,
  } as WidgetInstance;
}

describe('getWidgetSetupIssues — schema-driven required fields', () => {
  it('flags a heatmap missing its required second dimension (groupField)', () => {
    // Switching bar -> heatmap carries x/yMetrics forward but nothing seeds
    // groupField ("Down (rows)"), which heatmap's own config marks required -
    // the old generic hasFields check missed this because x alone satisfied it.
    const w = widget({
      chartType: 'heatmap',
      chartQuery: { x: 'region', yMetrics: [{ field: 'revenue', aggregation: 'sum' }] },
    });
    const issues = getWidgetSetupIssues(w);
    expect(issues.some((i) => i.key === 'fields')).toBe(true);
  });

  it('does not flag a fully-configured heatmap', () => {
    const w = widget({
      chartType: 'heatmap',
      chartQuery: {
        tableName: 'sales',
        x: 'region',
        groupField: 'month',
        yMetrics: [{ field: 'revenue', aggregation: 'sum' }],
      },
    });
    expect(isWidgetSetupComplete(w)).toBe(true);
  });

  it('flags a stat widget switched to bar that never got an x field', () => {
    // stat has no x field at all, so switching stat -> bar leaves x unset
    // while yMetrics (carried over) is still populated - the old check
    // treated "yMetrics has something" as good enough for any type.
    const w = widget({
      chartType: 'bar',
      chartQuery: { yMetrics: [{ field: 'revenue', aggregation: 'sum' }] },
    });
    const issues = getWidgetSetupIssues(w);
    expect(issues.some((i) => i.key === 'fields')).toBe(true);
  });

  it('does not flag a stat widget for a missing x field (stat has none)', () => {
    const w = widget({ chartType: 'stat', chartQuery: { yMetrics: [{ field: 'revenue', aggregation: 'sum' }] } });
    expect(isWidgetSetupComplete(w)).toBe(true);
  });

  it('does not flag a stat widget using a field-less count aggregate instead of yMetrics', () => {
    // A truthy chartQuery.aggregate with no yMetrics is a real,
    // backend-executable "count of rows" query (chart_service.py's
    // documented { x, aggregate: 'count' } shape, e.g. from AI-generated
    // widgets) - COUNT(*) needs no field, unlike sum/avg/min/max which do.
    const w = widget({ chartType: 'stat', chartQuery: { aggregate: true } });
    expect(isWidgetSetupComplete(w)).toBe(true);
  });

  it('still flags a stat widget with neither yMetrics nor an aggregate set', () => {
    const w = widget({ chartType: 'stat', chartQuery: {} });
    expect(getWidgetSetupIssues(w).some((i) => i.key === 'fields')).toBe(true);
  });

  it('does not flag a scatter widget with both x/y metrics populated', () => {
    const w = widget({
      chartType: 'scatter',
      chartQuery: {
        tableName: 'sales',
        xMetrics: [{ field: 'spend', aggregation: 'sum' }],
        yMetrics: [{ field: 'revenue', aggregation: 'sum' }],
      },
    });
    expect(isWidgetSetupComplete(w)).toBe(true);
  });

  it('flags a scatter widget missing its y metric', () => {
    const w = widget({ chartType: 'scatter', chartQuery: { xMetrics: [{ field: 'spend', aggregation: 'sum' }] } });
    expect(getWidgetSetupIssues(w).some((i) => i.key === 'fields')).toBe(true);
  });
});

describe('getWidgetSetupIssues — SQL-bound widgets', () => {
  it('does not flag a saved-query-bound bar widget for a missing table or missing x/yMetrics', () => {
    // bindSavedQuery() deletes tableName and populates data from the query's
    // own result columns, not the x/yMetrics shelves - it must not be
    // penalized for either.
    const w = widget({
      chartType: 'bar',
      chartQuery: { saved_query_id: '42' },
    });
    const issues = getWidgetSetupIssues(w);
    expect(issues.some((i) => i.key === 'table')).toBe(false);
    expect(issues.some((i) => i.key === 'fields')).toBe(false);
  });

  it('still flags a non-SQL-bound bar widget with no table and no fields', () => {
    const w = widget({ chartType: 'bar', chartQuery: {} });
    const issues = getWidgetSetupIssues(w);
    expect(issues.some((i) => i.key === 'table')).toBe(true);
    expect(issues.some((i) => i.key === 'fields')).toBe(true);
  });
});
