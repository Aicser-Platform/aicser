import { describe, expect, it, vi } from 'vitest';

vi.mock('react-grid-layout', () => ({ Responsive: () => null, WidthProvider: (c: unknown) => c }));
vi.mock('@/hooks/useBreakpoint', () => ({ default: () => ({}) }));

import { buildPreviewLayout, phoneWidgets } from '../DashboardViewerGrid';

const w = (id: string, chartType: string, extra: Record<string, unknown> = {}) =>
  ({ id, chartType, title: id, chartOptions: extra }) as never;

describe('phone layout', () => {
  it('puts two KPIs side by side and every other card on its own row', () => {
    const widgets = [w('k1', 'stat'), w('k2', 'stat'), w('k3', 'stat'), w('bar', 'bar')];
    const layout = [
      { i: 'k1', x: 0, y: 0, w: 3, h: 3 },
      { i: 'k2', x: 3, y: 0, w: 3, h: 3 },
      { i: 'k3', x: 6, y: 0, w: 3, h: 3 },
      { i: 'bar', x: 0, y: 3, w: 12, h: 6 },
    ];
    const out = buildPreviewLayout(widgets, layout as never, 4, 1);
    const byId = Object.fromEntries(out.map((l) => [l.i, l]));
    expect([byId.k1.w, byId.k2.w]).toEqual([2, 2]);
    expect(byId.k1.y).toBe(byId.k2.y);
    expect(byId.k3.w).toBe(4); // an odd KPI out takes the row
    expect(byId.bar.w).toBe(4);
    expect(byId.bar.y).toBeGreaterThan(byId.k3.y);
  });

  it('leaves out widgets the author hid from phones', () => {
    expect(phoneWidgets([w('a', 'bar'), w('b', 'table', { hideOnMobile: true })]).map((x: { id: string }) => x.id)).toEqual(['a']);
  });
});
