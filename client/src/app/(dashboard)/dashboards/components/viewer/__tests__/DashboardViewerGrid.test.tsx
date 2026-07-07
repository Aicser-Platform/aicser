import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DashboardViewerGrid } from '../DashboardViewerGrid';
import type { LayoutItem, WidgetInstance } from '../../../stores/useDashboardStore';

// Capture whatever props DashboardViewerGrid hands to react-grid-layout's
// Responsive component so we can assert on `cols`/`layouts` without needing
// jsdom to perform real pixel layout (offsetWidth is always 0 there).
let capturedProps: { cols: Record<string, number>; layouts: Record<string, LayoutItem[]> } | null = null;

vi.mock('react-grid-layout', () => ({
  Responsive: (props: { cols: Record<string, number>; layouts: Record<string, LayoutItem[]>; children: React.ReactNode }) => {
    capturedProps = props;
    return <div data-testid="grid">{props.children}</div>;
  },
  WidthProvider: (Component: unknown) => Component,
}));

vi.mock('../../DashboardWidgetCell', () => ({
  DashboardWidgetCell: ({ widget }: { widget: WidgetInstance }) => <div>{widget.id}</div>,
}));

function makeWidget(id: string): WidgetInstance {
  return {
    id,
    title: id,
    chartType: 'bar',
  } as WidgetInstance;
}

describe('DashboardViewerGrid (preserve mode)', () => {
  it('keeps every breakpoint on the same 12-column grid the Studio canvas uses, so saved x/w positions stay valid at every width', () => {
    // Three widgets sitting side-by-side across a 12-col row, as the Studio canvas
    // (DashboardCanvas.tsx, cols 12 at every breakpoint) would have saved them.
    const layout: LayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
      { i: 'c', x: 8, y: 0, w: 4, h: 6 },
    ];
    const widgets = [makeWidget('a'), makeWidget('b'), makeWidget('c')];

    render(
      <DashboardViewerGrid
        widgets={widgets}
        layout={layout}
        dashboardId="d1"
        runtimeFilters={[]}
        onCrossFilter={() => {}}
        layoutMode="preserve"
      />
    );

    expect(capturedProps).not.toBeNull();
    const { cols, layouts } = capturedProps!;

    for (const bp of ['lg', 'md', 'sm', 'xs', 'xxs']) {
      const bpCols = cols[bp];
      for (const item of layouts[bp]) {
        expect(item.x + item.w).toBeLessThanOrEqual(bpCols);
      }
    }
  });
});
