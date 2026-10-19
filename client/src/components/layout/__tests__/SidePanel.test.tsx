import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SidePanel } from '../SidePanel';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => `${key}:${values?.name ?? ''}`,
}));

describe('SidePanel', () => {
  beforeEach(() => window.localStorage.clear());

  it('folds to a rail and opens again, remembering the choice', () => {
    const { unmount } = render(<SidePanel id="t.steps" side="left" title="Steps"><p>content</p></SidePanel>);
    expect(screen.getByText('content')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'panel_collapse:Steps' }));
    expect(screen.queryByText('content')).toBeNull();
    expect(window.localStorage.getItem('aicser.panel.t.steps')).toBe('1');
    unmount();

    render(<SidePanel id="t.steps" side="left" title="Steps"><p>content</p></SidePanel>);
    expect(screen.queryByText('content')).toBeNull(); // still folded after a reload
    fireEvent.click(screen.getAllByRole('button', { name: 'panel_expand:Steps' })[0]);
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('starts folded when the default says so, until the person chooses', () => {
    render(<SidePanel id="t.suggest" side="right" title="Suggestions" defaultCollapsed={() => true}><p>tips</p></SidePanel>);
    expect(screen.queryByText('tips')).toBeNull();
  });
});
