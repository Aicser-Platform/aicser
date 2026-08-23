import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { StatWidget } from '../StatWidget';

describe('StatWidget null vs. real-zero', () => {
  it('shows a "no data" placeholder when the query returns all-NULL values, not a fake 0', () => {
    render(
      <StatWidget
        data={{ x: ['Jan', 'Feb', 'Mar'], y: [null, null, null] as unknown as number[] }}
        config={{ title: 'Monthly Revenue', format: 'currency' }}
      />,
    );
    expect(screen.getByText('no_data_value')).toBeTruthy();
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('still renders a genuine 0 as a real formatted zero', () => {
    render(
      <StatWidget
        data={{ x: ['Jan', 'Feb', 'Mar'], y: [10, 5, 0] }}
        config={{ title: 'Monthly Revenue', format: 'currency' }}
      />,
    );
    expect(screen.queryByText('no_data_value')).toBeNull();
    expect(screen.getByText('$0')).toBeTruthy();
  });
});
