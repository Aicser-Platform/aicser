import { describe, expect, it } from 'vitest';
import { anchorRelativeDateDefaults } from '../anchorDateDefaults';

const filter = { id: 'f', name: 'Date', field: 'order_date', type: 'dateRange', default: 'last_30_days', dataSourceId: 'ds' } as never;
const window = [
  { field: 'order_date', operator: '>=', value: '2026-08-27', type: 'date' },
  { field: 'order_date', operator: '<=', value: '2026-09-25', type: 'date' },
];

describe('relative date defaults over older data', () => {
  it('lays the same window over the latest data when the data ended earlier', async () => {
    const out = await anchorRelativeDateDefaults([filter], window, async () => '2024-12-31');
    expect(out.map((r) => r.value)).toEqual(['2024-12-02', '2024-12-31']);
  });

  it('leaves up-to-date data alone', async () => {
    const out = await anchorRelativeDateDefaults([filter], window, async () => '2026-09-24');
    expect(out).toEqual(window);
  });

  it('leaves fixed-date defaults alone', async () => {
    const fixed = { ...(filter as object), default: ['2024-01-01', '2024-01-31'] } as never;
    const out = await anchorRelativeDateDefaults([fixed], window, async () => '2023-01-01');
    expect(out).toEqual(window);
  });
});
