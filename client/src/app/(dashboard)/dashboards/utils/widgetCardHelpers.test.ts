import { describe, expect, it } from 'vitest';
import { shouldShowWidgetHeader } from './widgetCardHelpers';

describe('shouldShowWidgetHeader', () => {
  it('hides header for divider widgets', () => {
    expect(shouldShowWidgetHeader({ chartType: 'divider' })).toBe(false);
  });

  it('shows header for chart widgets even without title', () => {
    expect(shouldShowWidgetHeader({ chartType: 'bar', title: '' })).toBe(true);
  });

  it('hides text widget header until title or selection', () => {
    expect(shouldShowWidgetHeader({ chartType: 'text', title: '' })).toBe(false);
    expect(shouldShowWidgetHeader({ chartType: 'text', title: 'Notes' })).toBe(true);
    expect(shouldShowWidgetHeader({ chartType: 'text', title: '' }, { isSelected: true })).toBe(true);
  });
});
