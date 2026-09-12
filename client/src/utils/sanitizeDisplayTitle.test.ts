import { describe, expect, it } from 'vitest';
import {
  feedItemDisplayDescription,
  feedItemDisplayTitle,
  isWeakDisplayTitle,
  sanitizeDisplayTitle,
  stripPiiPlaceholders,
} from './sanitizeDisplayTitle';

describe('sanitizeDisplayTitle', () => {
  it('strips Presidio tokens from titles', () => {
    expect(stripPiiPlaceholders('<DATE_TIME> Performance')).toBe('Performance');
    expect(isWeakDisplayTitle('<DATE_TIME> Performance')).toBe(true);
  });

  it('rejects request phrasing as a title', () => {
    expect(isWeakDisplayTitle('How About Build A Dashboard For')).toBe(true);
  });

  it('uses a snapshot widget title when the post title is a request echo', () => {
    const title = feedItemDisplayTitle(
      {
        title: 'How About Build A Dashboard For',
        asset: {
          previewLabel: 'Dashboard',
          snapshotPayload: {
            visuals: {
              widgets: [
                { title: 'Principal Amount Overview', chartType: 'stat' },
                { title: 'Principal Amount Trend', chartType: 'line' },
              ],
            },
          },
        },
      },
      'Dashboard',
    );
    expect(title).toBe('Principal Amount Overview');
  });

  it('does not keep Analytics or Chart as a visible title', () => {
    expect(sanitizeDisplayTitle('Analytics', 'Chart')).toBe('');
    expect(isWeakDisplayTitle('Analytics')).toBe(true);
  });

  it('uses the in-chart title when the post is labeled Analytics', () => {
    expect(
      feedItemDisplayTitle({
        title: 'Analytics',
        asset: {
          previewLabel: 'Analytics',
          chartWidget: {
            chartOptions: { title: 'Principal Amount Share by Npl Flag' },
          },
        },
      }),
    ).toBe('Principal Amount Share by Npl Flag');
  });

  it('hides Generated from: prompt copy', () => {
    expect(
      feedItemDisplayDescription('Generated from: how about build a dashboard for our management'),
    ).toBe('');
  });

  it('keeps long executive narration even when it contains title-like phrases', () => {
    const prose =
      'Show of strength: average score rose 4.2 points. The chart for segment drivers highlights cohort A as the main lift across the term.';
    expect(feedItemDisplayDescription(prose)).toBe(prose);
  });
});
