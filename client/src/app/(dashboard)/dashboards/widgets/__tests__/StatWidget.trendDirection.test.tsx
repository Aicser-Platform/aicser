import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { StatWidget } from '../StatWidget';

describe('StatWidget trend direction vs. metric semantics', () => {
  it('colors an increase green by default (up is good)', () => {
    const { container } = render(
      <StatWidget
        data={{ value: 120, comparisonValue: 100 }}
        config={{ title: 'Revenue' }}
      />,
    );
    expect(screen.getByText('+20.0%')).toBeTruthy();
    expect(container.querySelector('.number-positive')).toBeTruthy();
    expect(container.querySelector('.number-negative')).toBeNull();
  });

  it('colors an increase RED when trendGoodDirection is "down" (e.g. cost/error-rate)', () => {
    const { container } = render(
      <StatWidget
        data={{ value: 120, comparisonValue: 100 }}
        config={{ title: 'Error Rate', trendGoodDirection: 'down' }}
      />,
    );
    // Direction shown is still a real increase...
    expect(screen.getByText('+20.0%')).toBeTruthy();
    // ...but colored as unfavorable, since for this metric going up is bad.
    expect(container.querySelector('.number-negative')).toBeTruthy();
    expect(container.querySelector('.number-positive')).toBeNull();
  });

  it('colors a decrease green when trendGoodDirection is "down"', () => {
    const { container } = render(
      <StatWidget
        data={{ value: 80, comparisonValue: 100 }}
        config={{ title: 'Error Rate', trendGoodDirection: 'down' }}
      />,
    );
    expect(screen.getByText('-20.0%')).toBeTruthy();
    expect(container.querySelector('.number-positive')).toBeTruthy();
    expect(container.querySelector('.number-negative')).toBeNull();
  });
});
