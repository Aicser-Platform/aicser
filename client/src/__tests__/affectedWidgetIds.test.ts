import { describe, expect, it } from 'vitest';
import { getAffectedWidgetIds } from '@/app/(dashboard)/dashboards/utils/affectedWidgetIds';
import type { DashboardFilter } from '@/types/dashboard';
import type { WidgetInstance } from '@/app/(dashboard)/dashboards/stores/useDashboardStore';

const widget = (id: string): WidgetInstance =>
  ({
    id,
    chartId: `chart-${id}`,
    dataSourceId: 'ds-1',
    title: id,
    chartType: 'bar',
  }) as WidgetInstance;

describe('getAffectedWidgetIds', () => {
  it('refreshes all data widgets when a configured date filter is cleared', () => {
    const widgets = [widget('a'), widget('b')];
    const configs: DashboardFilter[] = [
      { id: 'd', field: 'disbursement_date', name: 'Date', type: 'dateRange', isGlobal: true },
    ];
    const ids = getAffectedWidgetIds(widgets, [], configs, ['disbursement_date']);
    expect(ids).toEqual(['a', 'b']);
  });

  it('refreshes widgets even when they have no dataSourceId', () => {
    const widgets = [
      { ...widget('a'), dataSourceId: undefined },
    ] as WidgetInstance[];
    const ids = getAffectedWidgetIds(
      widgets,
      [{ field: 'npl_flag', operator: '=', value: 'Y' }],
      [{ id: 'n', field: 'npl_flag', name: 'NPL', type: 'dropdown', isGlobal: true }],
    );
    expect(ids).toEqual(['a']);
  });
});
