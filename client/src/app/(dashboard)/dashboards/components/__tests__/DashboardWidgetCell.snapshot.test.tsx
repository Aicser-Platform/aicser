import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../widgets/WidgetPreview', () => ({
  WidgetPreview: () => <div data-testid="chart" />,
}));

import { DashboardWidgetCell } from '../DashboardWidgetCell';
import type { WidgetInstance } from '../../stores/useDashboardStore';

// Feed snapshots rebuild widgets from the captured payload: chartData, no source/table.
const snapshotWidget = (chartData: unknown) =>
  ({ id: 'w1', title: 'Total Quantity', chartType: 'stat', chartData, chartQuery: {} }) as unknown as WidgetInstance;

describe('DashboardWidgetCell with a feed snapshot widget', () => {
  it('draws captured data even though the widget has no data source', () => {
    render(<DashboardWidgetCell widget={snapshotWidget({ x: ['Total'], y: [353], value: 353 })} runtimeFilters={[]} readOnly />);

    expect(screen.queryByText('widget_error_not_connected_title')).toBeNull();
    expect(screen.getByTestId('chart')).toBeTruthy();
  });

  it('still says "not connected" when there is no source and no data', () => {
    render(<DashboardWidgetCell widget={snapshotWidget(undefined)} runtimeFilters={[]} readOnly />);

    expect(screen.getByText('widget_error_not_connected_title')).toBeTruthy();
  });
});
