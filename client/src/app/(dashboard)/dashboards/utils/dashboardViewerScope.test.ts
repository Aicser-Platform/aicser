import { describe, expect, it } from 'vitest';
import { filterVisibleLayout, filterVisibleWidgets } from './dashboardViewerScope';
import type { LayoutItem, WidgetInstance } from '../stores/useDashboardStore';

const widgets: WidgetInstance[] = [
  { id: 'widget-a', chartType: 'bar', title: 'A' } as WidgetInstance,
  { id: 'widget-b', chartType: 'bar', title: 'B' } as WidgetInstance,
];

const layout: LayoutItem[] = [
  { i: 'widget-a', x: 0, y: 0, w: 4, h: 4, pageId: 'page-1' },
  { i: 'widget-b', x: 4, y: 0, w: 4, h: 4, pageId: 'page-2' },
];

describe('dashboardViewerScope', () => {
  it('filters widgets by active page when pages exist', () => {
    const visible = filterVisibleWidgets(widgets, layout, 'page-1', [
      { id: 'page-1', name: 'One' },
      { id: 'page-2', name: 'Two' },
    ], 'page-1');
    expect(visible.map((w) => w.id)).toEqual(['widget-a']);
  });

  it('includes unscoped widgets on default page', () => {
    const looseLayout: LayoutItem[] = [
      { i: 'widget-a', x: 0, y: 0, w: 4, h: 4 },
      { i: 'widget-b', x: 4, y: 0, w: 4, h: 4, pageId: 'page-2' },
    ];
    const visible = filterVisibleWidgets(
      widgets,
      looseLayout,
      'page-1',
      [{ id: 'page-1', name: 'One' }, { id: 'page-2', name: 'Two' }],
      'page-1',
    );
    expect(visible.map((w) => w.id)).toEqual(['widget-a']);
  });

  it('filters layout to visible widgets', () => {
    const visible = filterVisibleWidgets(widgets, layout, 'page-2', [
      { id: 'page-1', name: 'One' },
      { id: 'page-2', name: 'Two' },
    ], 'page-1');
    expect(filterVisibleLayout(layout, visible).map((l) => l.i)).toEqual(['widget-b']);
  });
});
