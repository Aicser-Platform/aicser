import { describe, expect, it } from 'vitest';
import { detectFilterFieldConflicts, isSlicerFieldConflicted } from './filterConflicts';
import type { DashboardFilter } from '@/types/dashboard';
import type { WidgetInstance } from '../stores/useDashboardStore';

describe('detectFilterFieldConflicts', () => {
  it('returns empty when slicer fields are unique', () => {
    const global: DashboardFilter[] = [{ id: '1', name: 'Region', type: 'dropdown', field: 'region' }];
    const widgets = [] as WidgetInstance[];
    expect(detectFilterFieldConflicts(global, [], widgets)).toEqual([]);
  });

  it('flags overlap between global filter and canvas slicer', () => {
    const global: DashboardFilter[] = [{ id: '1', name: 'Region', type: 'dropdown', field: 'region' }];
    const widgets = [
      {
        id: 'w1',
        chartType: 'slicer',
        chartQuery: { field: 'region' },
      },
    ] as WidgetInstance[];
    const conflicts = detectFilterFieldConflicts(global, [], widgets);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe('region');
    expect(conflicts[0].sources).toContain('global');
    expect(conflicts[0].sources).toContain('slicer');
  });

  it('is case-insensitive for field matching', () => {
    const conflicts = detectFilterFieldConflicts(
      [{ id: '1', name: 'X', type: 'dropdown', field: 'Region' }],
      [],
      [{ id: 'w1', chartType: 'slicer', chartQuery: { field: 'region' } }] as WidgetInstance[],
    );
    expect(conflicts).toHaveLength(1);
    expect(isSlicerFieldConflicted('Region', conflicts)?.field).toBe('Region');
  });
});
