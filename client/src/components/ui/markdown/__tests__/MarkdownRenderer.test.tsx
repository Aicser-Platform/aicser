import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/Providers/ThemeModeContext', () => ({ useThemeMode: () => ({ isDarkMode: false }) }));

import MarkdownRenderer from '../MarkdownRenderer';

describe('shared MarkdownRenderer', () => {
  it('renders tables, code with copy, and footnote citations', () => {
    const md = [
      '| Region | Sales |', '|---|---|', '| North | 10 |', '',
      'Revenue grew[^1].', '', '```sql', 'SELECT 1;', '```', '',
      '[^1]: Orders table, 2025.',
    ].join('\n');
    const { container } = render(<MarkdownRenderer content={md} />);
    expect(container.querySelector('table.markdown-table')).not.toBeNull();
    expect(screen.getByRole('button', { name: /copy code/i })).toBeTruthy();
    expect(container.querySelector('sup a[data-footnote-ref]')).not.toBeNull();
    expect(container.querySelector('section.footnotes')?.textContent).toContain('Orders table');
    expect(container.querySelector('pre pre')).toBeNull(); // no code box nested in another
  });

  it('never renders raw HTML or script links', () => {
    const { container } = render(<MarkdownRenderer content={'<img src=x onerror="alert(1)"> [x](javascript:alert(1))'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/^javascript:/);
  });
});
