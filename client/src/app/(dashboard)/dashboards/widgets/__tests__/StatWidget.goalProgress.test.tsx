import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { StatWidget } from '../StatWidget';

function fillWidthPercent(container: HTMLElement): number {
  const fill = container.querySelector('.goal-progress-fill') as HTMLElement | null;
  return fill ? parseFloat(fill.style.width) : NaN;
}

describe('StatWidget goal progress — threshold direction awareness', () => {
  it('"up is good" (default): value/goal ratio, unchanged from before', () => {
    const { container } = render(
      <StatWidget
        data={{ value: 60 }}
        config={{ title: 'Revenue', goalTarget: 120 }}
      />,
    );
    expect(fillWidthPercent(container)).toBeCloseTo(50, 5);
  });

  it('"down is good": a great result well under goal shows a FULL bar, not nearly-empty', () => {
    // Error rate target <= 1%, actual 0.3% — naive value/goal would show ~30% (looks bad);
    // this is actually a great result and should read as fully achieved.
    const { container } = render(
      <StatWidget
        data={{ value: 0.3 }}
        config={{ title: 'Error Rate', goalTarget: 1, trendGoodDirection: 'down' }}
      />,
    );
    expect(fillWidthPercent(container)).toBe(100);
  });

  it('"down is good": exactly at goal is still fully achieved', () => {
    const { container } = render(
      <StatWidget
        data={{ value: 1 }}
        config={{ title: 'Error Rate', goalTarget: 1, trendGoodDirection: 'down' }}
      />,
    );
    expect(fillWidthPercent(container)).toBe(100);
  });

  it('"down is good": exceeding the goal depletes the bar instead of overflowing past 100%', () => {
    // Double the goal (2 vs target 1) drains the bar to 0.
    const { container } = render(
      <StatWidget
        data={{ value: 2 }}
        config={{ title: 'Error Rate', goalTarget: 1, trendGoodDirection: 'down' }}
      />,
    );
    expect(fillWidthPercent(container)).toBe(0);
  });
});
