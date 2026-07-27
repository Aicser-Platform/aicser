import { describe, expect, it } from 'vitest';
import { shouldShowWidgetHeader } from './widgetCardHelpers';

describe('shouldShowWidgetHeader', () => {
  it('hides header for divider widgets', () => {
    expect(shouldShowWidgetHeader({ chartType: 'divider' })).toBe(false);
  });

  it('shows header for chart widgets even without title', () => {
    expect(shouldShowWidgetHeader({ chartType: 'bar', title: '' })).toBe(true);
  });

  it('never shows card header for text — title renders inside TextWidget', () => {
    expect(shouldShowWidgetHeader({ chartType: 'text', title: '' })).toBe(false);
    expect(shouldShowWidgetHeader({ chartType: 'text', title: 'Notes' })).toBe(false);
    expect(shouldShowWidgetHeader({ chartType: 'text', title: 'Notes' }, { isSelected: true })).toBe(false);
  });

  it('hides KPI header for inline-title layouts unless selected', () => {
    expect(
      shouldShowWidgetHeader({ chartType: 'stat', title: 'Revenue', chartOptions: { layout: 'executive' } }),
    ).toBe(false);
    expect(
      shouldShowWidgetHeader(
        { chartType: 'stat', title: 'Revenue', chartOptions: { layout: 'tile' } },
        { isSelected: true },
      ),
    ).toBe(true);
    expect(
      shouldShowWidgetHeader({ chartType: 'stat', title: 'Revenue', chartOptions: { layout: 'default' } }),
    ).toBe(true);
  });
});
