import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { StatWidget } from '../StatWidget';

describe('StatWidget executive layout text color', () => {
  it('renders white text for value, label, and card container in executive layout', () => {
    const { container } = render(
      <StatWidget
        data={{ value: 6430000 }}
        config={{
          title: 'Principal Amount Overview',
          format: 'currency',
          layout: 'executive',
          color: '#00c2cb',
        }}
      />,
    );

    const root = container.querySelector('.studio-stat-executive') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.color).toBe('rgb(255, 255, 255)');

    const valueEl = container.querySelector('.studio-stat-executive-value') as HTMLElement;
    expect(valueEl).toBeTruthy();
    expect(valueEl.style.color).toBe('rgb(255, 255, 255)');

    const labelEl = container.querySelector('.studio-stat-executive-label') as HTMLElement;
    expect(labelEl).toBeTruthy();
    expect(labelEl.textContent).toBe('Principal Amount Overview');
    expect(labelEl.style.color).toBe('rgba(255, 255, 255, 0.9)');
  });
});
