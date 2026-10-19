import { describe, expect, it } from 'vitest';
import { countDuplicateFileSources } from '../workbookDataSource';
import type { DataSource } from '@/stores/useDataSourceStore';

const file = (name: string, id: string, project = 'p1'): DataSource =>
  ({
    id,
    name,
    type: 'file',
    project_id: project,
    is_active: true,
  }) as DataSource;

describe('countDuplicateFileSources', () => {
  it('counts extras in same-name groups', () => {
    expect(
      countDuplicateFileSources([
        file('Sales (Sheet)', '1'),
        file('Sales (Sheet)', '2'),
        file('Other.xlsx', '3'),
      ]),
    ).toBe(1);
  });

  it('ignores unique names', () => {
    expect(countDuplicateFileSources([file('A', '1'), file('B', '2')])).toBe(0);
  });
});
