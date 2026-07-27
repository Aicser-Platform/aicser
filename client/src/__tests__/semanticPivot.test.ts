import { describe, expect, it } from 'vitest';

import { buildPivot } from '../../ee/src/ee/components/semantic/pivot';

const ROWS = [
  { country: 'Cambodia', month: '2026-01', total_revenue: 100, order_count: 4 },
  { country: 'Cambodia', month: '2026-02', total_revenue: 150, order_count: 6 },
  { country: 'Thailand', month: '2026-01', total_revenue: 80, order_count: 2 },
];

describe('buildPivot', () => {
  it('pivots one metric across row and column dimensions', () => {
    const p = buildPivot(ROWS, 'country', 'month', ['total_revenue']);
    expect(p.colKeys).toEqual(['2026-01', '2026-02']);
    expect(p.rows).toHaveLength(2);
    const cambodia = p.rows.find((r) => r.rowKey === 'Cambodia')!;
    expect(cambodia.cells['2026-01'].total_revenue).toBe(100);
    expect(cambodia.cells['2026-02'].total_revenue).toBe(150);
    expect(cambodia.rowTotal.total_revenue).toBe(250);
  });

  it('missing cells are null and excluded from totals', () => {
    const p = buildPivot(ROWS, 'country', 'month', ['total_revenue']);
    const thailand = p.rows.find((r) => r.rowKey === 'Thailand')!;
    expect(thailand.cells['2026-02'].total_revenue).toBeNull();
    expect(thailand.rowTotal.total_revenue).toBe(80);
    expect(p.colTotals['2026-01'].total_revenue).toBe(180);
    expect(p.colTotals['2026-02'].total_revenue).toBe(150);
    expect(p.grandTotal.total_revenue).toBe(330);
  });

  it('supports multiple metrics per cell', () => {
    const p = buildPivot(ROWS, 'country', 'month', ['total_revenue', 'order_count']);
    const cambodia = p.rows.find((r) => r.rowKey === 'Cambodia')!;
    expect(cambodia.cells['2026-01'].order_count).toBe(4);
    expect(p.grandTotal.order_count).toBe(12);
  });

  it('handles a null column dimension as a single flat column', () => {
    const p = buildPivot(ROWS, 'country', null, ['total_revenue']);
    expect(p.colKeys).toEqual(['value']);
    const cambodia = p.rows.find((r) => r.rowKey === 'Cambodia')!;
    // both Cambodia rows aggregate into one cell
    expect(cambodia.cells['value'].total_revenue).toBe(250);
  });

  it('column keys sort stably (string ascending)', () => {
    const shuffled = [...ROWS].reverse();
    const p = buildPivot(shuffled, 'country', 'month', ['total_revenue']);
    expect(p.colKeys).toEqual(['2026-01', '2026-02']);
    expect(p.rows.map((r) => r.rowKey)).toEqual(['Cambodia', 'Thailand']);
  });

  it('non-numeric metric values are ignored in totals but kept in cells', () => {
    const rows = [
      { country: 'KH', month: 'm1', total_revenue: 'n/a' },
      { country: 'KH', month: 'm2', total_revenue: 10 },
    ];
    const p = buildPivot(rows, 'country', 'month', ['total_revenue']);
    const kh = p.rows[0];
    expect(kh.cells['m1'].total_revenue).toBe('n/a');
    expect(kh.rowTotal.total_revenue).toBe(10);
  });
});
