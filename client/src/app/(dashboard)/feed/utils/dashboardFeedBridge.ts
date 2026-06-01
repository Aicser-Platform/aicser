import type { LayoutItem, WidgetInstance } from '@/app/(dashboard)/dashboards/stores/dashboardStoreTypes';
import type { DashboardFilter } from '@/types/dashboard';

/** Snapshot metadata stored on feed posts when publishing a dashboard. */
export type DashboardFeedPreviewMetadata = {
  previewType: 'dashboard';
  previewLabel: string;
  dashboardId: string;
  widgetCount: number;
  pageCount: number;
  filterCount: number;
  defaultPageId?: string | null;
  /** Compact layout for card thumbnails (optional). */
  layoutSummary?: Array<Pick<LayoutItem, 'i' | 'x' | 'y' | 'w' | 'h' | 'pageId'>>;
  excerpt?: string;
};

export function buildDashboardFeedPreviewMetadata(params: {
  dashboardId: string;
  title: string;
  description?: string;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  globalFilters?: DashboardFilter[];
  pageFilters?: DashboardFilter[];
  pages?: { id: string }[];
  defaultPageId?: string | null;
}): DashboardFeedPreviewMetadata {
  const {
    dashboardId,
    title,
    description,
    widgets,
    layout,
    globalFilters = [],
    pageFilters = [],
    pages = [],
    defaultPageId,
  } = params;

  const filterCount = globalFilters.length + pageFilters.length;

  return {
    previewType: 'dashboard',
    previewLabel: title,
    dashboardId,
    widgetCount: widgets.length,
    pageCount: Math.max(pages.length, 1),
    filterCount,
    defaultPageId: defaultPageId ?? pages[0]?.id ?? null,
    layoutSummary: layout.slice(0, 12).map(({ i, x, y, w, h, pageId }) => ({ i, x, y, w, h, pageId })),
    excerpt:
      description?.trim() ||
      `${widgets.length} widget${widgets.length === 1 ? '' : 's'}${filterCount ? ` · ${filterCount} filter${filterCount === 1 ? '' : 's'}` : ''}`,
  };
}

export function feedPostIdFromDashboardConfig(config?: Record<string, unknown> | null): string | null {
  const id = config?.feed_post_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

export function feedPostUrl(postId: string): string {
  return `/feed/${encodeURIComponent(postId)}`;
}

export function publicFeedPostUrl(postId: string): string {
  return `/discover/${encodeURIComponent(postId)}`;
}

export function feedSnapshotFingerprintFromDashboardConfig(
  config?: Record<string, unknown> | null,
): string | null {
  const fp = config?.feed_snapshot_fingerprint;
  return typeof fp === 'string' && fp.trim() ? fp.trim() : null;
}

/** Stable hash of studio structure (excludes volatile chart data). */
export function computeStudioSnapshotFingerprint(params: {
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  globalFilters?: DashboardFilter[];
  pageFilters?: DashboardFilter[];
  pages?: { id: string; name: string }[];
}): string {
  const { widgets, layout, globalFilters = [], pageFilters = [], pages = [] } = params;
  const canonical = {
    pages: pages.map((p) => ({ id: p.id, name: p.name })),
    layout: layout.map(({ i, x, y, w, h, pageId }) => ({ i, x, y, w, h, pageId })),
    widgets: widgets.map((w) => ({
      id: w.id,
      chartId: w.chartId,
      chartType: w.chartType,
      title: w.title,
      chartQuery: w.chartQuery,
    })),
    filters: [...globalFilters, ...pageFilters].map((f) => ({
      id: f.id,
      field: f.field,
      type: f.type,
      tableName: f.tableName,
    })),
  };
  const raw = JSON.stringify(canonical);
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 33) ^ raw.charCodeAt(i);
  }
  return `fp-${(hash >>> 0).toString(16)}`;
}

export function isFeedSnapshotOutdated(params: {
  config?: Record<string, unknown> | null;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  globalFilters?: DashboardFilter[];
  pageFilters?: DashboardFilter[];
  pages?: { id: string; name: string }[];
}): boolean {
  const stored = feedSnapshotFingerprintFromDashboardConfig(params.config);
  if (!stored) return false;
  const current = computeStudioSnapshotFingerprint(params);
  return stored !== current;
}
