/** How many dashboard widgets a feed card should tease before "open for details". */
export const FEED_DASHBOARD_PREVIEW_MAX = 4;

/** Compact overflow mark for a feed tease — the card click already opens the rest. */
export function feedPreviewMoreBadge(overflow: number): string | null {
  if (overflow <= 0) return null;
  return `+${overflow}`;
}

export type FeedPreviewKind = 'text' | 'kpi' | 'chart';

export type FeedPreviewRecipe = {
  gridClass: string;
  heights: number[];
  spans: Array<'' | 'col-span-2'>;
  /** Single chart: fill a 16:9 frame instead of a short KPI tile. */
  chartOnly: boolean;
};

export function feedPreviewKind(chartType?: string | null): FeedPreviewKind {
  const t = (chartType || '').toLowerCase();
  if (
    t === 'text' ||
    t === 'markdown' ||
    t === 'richtext' ||
    t === 'html' ||
    t === 'image' ||
    t === 'embed'
  ) {
    return 'text';
  }
  if (
    t === 'stat' ||
    t === 'kpi' ||
    t === 'metric' ||
    t === 'gauge' ||
    t === 'number' ||
    t === 'big_number' ||
    t === 'big-number'
  ) {
    return 'kpi';
  }
  return 'chart';
}

export function isFeedPreviewableWidget(chartType?: string | null): boolean {
  const t = (chartType || '').toLowerCase();
  return t !== 'divider' && t !== 'slicer' && t !== 'filter';
}

/**
 * Choose what to tease on a feed card. Skip text/markdown when a chart or KPI
 * exists — the post already shows title + description, and a ~280px grid tile
 * cannot fit a readable two-column summary.
 */
export function pickFeedPreviewWidgets<T extends { chartType?: string | null }>(
  widgets: T[],
  max: number,
): T[] {
  const previewable = widgets.filter((w) => isFeedPreviewableWidget(w.chartType));
  const hasVisual = previewable.some((w) => feedPreviewKind(w.chartType) !== 'text');
  const pool = hasVisual
    ? previewable.filter((w) => feedPreviewKind(w.chartType) !== 'text')
    : previewable;
  const ordered = orderFeedPreviewWidgets(pool);
  if (max === 1) {
    const chart = ordered.find((w) => feedPreviewKind(w.chartType) === 'chart');
    if (chart) return [chart];
  }
  return ordered.slice(0, Math.max(0, max));
}

/** One chart + two supporting tiles: put the chart first so it can span full width. */
export function orderFeedPreviewWidgets<T extends { chartType?: string | null }>(widgets: T[]): T[] {
  if (widgets.length !== 3) return widgets;
  const charts = widgets.filter((w) => feedPreviewKind(w.chartType) === 'chart');
  if (charts.length !== 1) return widgets;
  const rest = widgets.filter((w) => feedPreviewKind(w.chartType) !== 'chart');
  return [...charts, ...rest];
}

export function feedDashboardPreviewRecipe(kinds: FeedPreviewKind[]): FeedPreviewRecipe {
  const n = Math.min(Math.max(kinds.length, 0), FEED_DASHBOARD_PREVIEW_MAX);
  const k = kinds.slice(0, n);

  if (n <= 1) {
    const kind = k[0] || 'chart';
    return {
      gridClass: 'grid-cols-1',
      heights: [kind === 'kpi' ? 140 : 280],
      spans: [''],
      chartOnly: kind === 'chart',
    };
  }

  if (n === 2) {
    const tall = k.some((x) => x === 'chart' || x === 'text');
    const h = tall ? 220 : 132;
    return { gridClass: 'grid-cols-2', heights: [h, h], spans: ['', ''], chartOnly: false };
  }

  if (n === 3) {
    if (k[0] === 'chart') {
      return {
        gridClass: 'grid-cols-2',
        heights: [220, 132, 132],
        spans: ['col-span-2', '', ''],
        chartOnly: false,
      };
    }
    return {
      gridClass: 'grid-cols-2',
      heights: k.map((x) => (x === 'chart' ? 180 : 132)),
      spans: ['', '', 'col-span-2'],
      chartOnly: false,
    };
  }

  const row1 = k.slice(0, 2).some((x) => x === 'chart') ? 180 : 128;
  const row2 = k.slice(2, 4).some((x) => x === 'chart') ? 180 : 128;
  return {
    gridClass: 'grid-cols-2',
    heights: [row1, row1, row2, row2],
    spans: ['', '', '', ''],
    chartOnly: false,
  };
}
