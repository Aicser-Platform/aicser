import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import { KPI_VALUE_MAX, KPI_VALUE_MIN, kpiLabelSize, kpiValueSize } from '../useKpiValueSize';
import { StatWidget } from '../StatWidget';

describe('KPI number size', () => {
  it('grows with the card, within a readable range', () => {
    const small = kpiValueSize(240, 120, 3);
    const tile = kpiValueSize(320, 180, 3);
    const large = kpiValueSize(900, 600, 3);
    expect(small).toBeGreaterThanOrEqual(KPI_VALUE_MIN);
    expect(tile).toBeGreaterThan(small);
    expect(large).toBe(KPI_VALUE_MAX);
  });

  it('never makes a long number wider than its card', () => {
    const chars = '$1,060,000.00'.length;
    const px = kpiValueSize(220, 400, chars);
    expect(px * 0.6 * chars).toBeLessThanOrEqual(220);
  });

  it('keeps the label at about a third of the number, between 11 and 16 px', () => {
    expect(kpiLabelSize(28)).toBe(11);
    expect(kpiLabelSize(48)).toBe(14);
    expect(kpiLabelSize(96)).toBe(16);
  });
});

describe('KPI format', () => {
  const view = (config: Record<string, unknown>, query?: Record<string, unknown>) =>
    render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
        <StatWidget data={{ value: 0.1088 } as never} config={{ title: 'Avg rate', ...config } as never} query={query as never} />
      </NextIntlClientProvider>,
    );

  it('shows a rate as a percentage when the Format tab says Percent', () => {
    view({ valueFormat: 'percent' });
    expect(screen.getByText('10.9%')).toBeInTheDocument();
  });

  it('uses the metric’s own format', () => {
    view({}, { yMetrics: [{ field: 'interest_rate', aggregation: 'avg', valueFormat: 'percent' }] });
    expect(screen.getByText('10.9%')).toBeInTheDocument();
  });
});
