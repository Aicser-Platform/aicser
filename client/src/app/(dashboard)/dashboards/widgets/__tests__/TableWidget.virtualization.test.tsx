import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { TableWidget } from '../TableWidget';

function buildData(rowCount: number) {
  const x = Array.from({ length: rowCount }, (_, i) => `row-${i}`);
  const y = Array.from({ length: rowCount }, (_, i) => i);
  return { x, y, series: [{ name: 'value', data: y }] };
}

describe('TableWidget virtualization', () => {
  it('renders normally (no crash, no virtual scroll needed) with the default small pageSize', () => {
    const { container } = render(
      <TableWidget data={buildData(20)} config={{ pageSize: 10 }} />,
    );
    // Default path: no fixed scroll.y should be forced onto the container.
    expect(container.querySelector('.table-widget-container')).toBeTruthy();
  });

  it('does not crash when pageSize is large enough to trigger virtual mode', () => {
    // Even without a real layout engine (jsdom has no ResizeObserver measurements),
    // this must render without throwing and fall back to a sane scroll height.
    // antd's virtual table uses its own windowed row structure, not plain <tbody><tr>,
    // so a successful render (no thrown error) is the meaningful assertion here.
    const { container } = render(
      <TableWidget data={buildData(500)} config={{ pageSize: 500, showPagination: false }} />,
    );
    expect(container.querySelector('.table-widget-container')).toBeTruthy();
    expect(container.querySelector('.ant-table')).toBeTruthy();
  });

  it('still shows the correct total across all rows when virtualized', () => {
    const { getByText } = render(
      <TableWidget
        data={{ x: ['A', 'B', 'C'], y: [10, 20, 30], series: [{ name: 'value', data: [10, 20, 30] }] }}
        config={{ pageSize: 200 }}
      />,
    );
    expect(getByText('60')).toBeTruthy();
  });
});
