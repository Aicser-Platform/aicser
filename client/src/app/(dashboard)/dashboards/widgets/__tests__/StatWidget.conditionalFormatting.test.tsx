import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { StatWidget } from '../StatWidget';

function valueColor(container: HTMLElement): string {
  const el = container.querySelector('.studio-stat-value') as HTMLElement | null;
  return el?.style.color ?? '';
}

describe('StatWidget conditional formatting (consolidated rule engine)', () => {
  it('applies a matching rule color to the value, taking priority over legacy thresholds', () => {
    const { container } = render(
      <StatWidget
        data={{ value: 500 }}
        config={{
          title: 'Revenue',
          // Legacy threshold would color this critical/red at >= 100...
          thresholdCritical: 100,
          thresholdDirection: 'above',
          // ...but a conditional formatting rule for the same value takes priority.
          conditionalFormatting: [
            { id: 'r1', column: 'value', operator: 'gte', value: '400', textColor: '#1677ff', applyTo: 'cell' },
          ],
        }}
      />,
    );
    expect(valueColor(container)).toBe('rgb(22, 119, 255)');
  });

  it('falls back to legacy threshold coloring when no rules are configured', () => {
    const { container } = render(
      <StatWidget
        data={{ value: 500 }}
        config={{ title: 'Revenue', thresholdCritical: 100, thresholdDirection: 'above' }}
      />,
    );
    expect(valueColor(container)).toBe('rgb(255, 77, 79)');
  });

  it('a non-matching rule leaves the legacy threshold color in place', () => {
    const { container } = render(
      <StatWidget
        data={{ value: 500 }}
        config={{
          title: 'Revenue',
          thresholdCritical: 100,
          thresholdDirection: 'above',
          conditionalFormatting: [
            { id: 'r1', column: 'value', operator: 'lt', value: '10', textColor: '#1677ff', applyTo: 'cell' },
          ],
        }}
      />,
    );
    expect(valueColor(container)).toBe('rgb(255, 77, 79)');
  });
});
