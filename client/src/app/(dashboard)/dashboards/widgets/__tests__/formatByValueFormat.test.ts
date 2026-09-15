import { describe, expect, it } from 'vitest';
import { formatByValueFormat } from '../WidgetRendererConfig';

describe('formatByValueFormat percent handling', () => {
  it('scales a unit-interval ratio to a percentage, matching Stat/tooltip formatting', () => {
    // Previously this branch did its own `${num}%` formatting with no unit-interval
    // scaling, so a conversion_rate of 0.15 (i.e. 15%) rendered as "0.15%" on a chart
    // axis/tooltip while the identical metric correctly showed "15.0%" in a Stat widget.
    expect(formatByValueFormat(0.15, 'percent')).toBe('15.0%');
  });

  it('leaves an already-scaled percentage (>1) unscaled', () => {
    expect(formatByValueFormat(42, 'percent')).toBe('42.0%');
  });

  it('handles 100% (unit-interval boundary) correctly', () => {
    expect(formatByValueFormat(1, 'percent')).toBe('100.0%');
  });
});
