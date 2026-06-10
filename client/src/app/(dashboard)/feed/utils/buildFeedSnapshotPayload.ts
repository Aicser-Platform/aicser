import type { LayoutItem, WidgetInstance } from '@/app/(dashboard)/dashboards/stores/dashboardStoreTypes';
import type { DashboardFilter } from '@/types/dashboard';
import type { AssetType } from '@/services/socialFeedService';
import type { ChatFeedChartPreview } from '@/components/Feed/chatFeedDraft';

export type FeedSnapshotPayload = {
  schemaVersion: 1;
  assetType: AssetType;
  narrative: {
    title: string;
    description?: string;
    questionTitle?: string;
    answerExcerpt?: string;
  };
  visuals: {
    widgets: Array<{
      id: string;
      title?: string;
      chartType?: string;
      chartOptions?: Record<string, unknown>;
      chartData?: Record<string, unknown>;
      chartQuery?: Record<string, unknown>;
      layout?: Partial<LayoutItem>;
    }>;
    layout: LayoutItem[];
    pages?: { id: string; name: string }[];
    filters?: {
      config?: DashboardFilter[];
      runtimeState?: unknown[];
    };
  };
  provenance: {
    sourcePath: '/chat' | '/chart-designer' | '/dashboards' | '/query-editor' | '/feed';
    conversationId?: string;
    messageId?: string;
    dashboardId?: string;
    chartId?: string;
    sourceQueryId?: string;
  };
  capturedAt?: string;
};

export function buildChartSnapshotPayload(params: {
  title: string;
  description?: string;
  chartWidget: ChatFeedChartPreview | Record<string, unknown>;
  sourcePath?: FeedSnapshotPayload['provenance']['sourcePath'];
  dashboardId?: string;
  chartId?: string;
}): FeedSnapshotPayload {
  const widget = params.chartWidget as Record<string, unknown>;
  return {
    schemaVersion: 1,
    assetType: 'chart',
    narrative: {
      title: params.title,
      description: params.description,
    },
    visuals: {
      widgets: [
        {
          id: 'snapshot-primary',
          title: params.title,
          chartType: String(widget.chartType || 'bar'),
          chartOptions: (widget.chartOptions as Record<string, unknown>) || {},
          chartData: (widget.chartData as Record<string, unknown>) || {},
          chartQuery: (widget.chartQuery as Record<string, unknown>) || {},
        },
      ],
      layout: [{ i: 'snapshot-primary', x: 0, y: 0, w: 12, h: 8 }],
    },
    provenance: {
      sourcePath: params.sourcePath || '/chart-designer',
      dashboardId: params.dashboardId,
      chartId: params.chartId,
    },
    capturedAt: new Date().toISOString(),
  };
}

export function buildDashboardSnapshotPayload(params: {
  dashboardId: string;
  title: string;
  description?: string;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  globalFilters?: DashboardFilter[];
  pageFilters?: DashboardFilter[];
  pages?: { id: string; name: string }[];
  runtimeFilters?: unknown[];
}): FeedSnapshotPayload {
  const {
    dashboardId,
    title,
    description,
    widgets,
    layout,
    globalFilters = [],
    pageFilters = [],
    pages = [],
    runtimeFilters = [],
  } = params;

  return {
    schemaVersion: 1,
    assetType: 'dashboard',
    narrative: { title, description },
    visuals: {
      widgets: widgets.map((w) => ({
        id: w.id,
        title: w.title,
        chartType: w.chartType,
        chartOptions: w.chartOptions as Record<string, unknown> | undefined,
        chartData: w.chartData as Record<string, unknown> | undefined,
        chartQuery: w.chartQuery as Record<string, unknown> | undefined,
        layout: layout.find((l) => l.i === w.id),
      })),
      layout,
      pages,
      filters: {
        config: [...globalFilters, ...pageFilters],
        runtimeState: runtimeFilters,
      },
    },
    provenance: {
      sourcePath: '/dashboards',
      dashboardId,
    },
    capturedAt: new Date().toISOString(),
  };
}

export function buildInsightSnapshotPayload(params: {
  title: string;
  description?: string;
  questionTitle?: string;
  excerpt?: string;
  chartPreview?: ChatFeedChartPreview;
  conversationId?: string;
  messageId?: string;
}): FeedSnapshotPayload {
  const widgets = params.chartPreview
    ? [
        {
          id: 'snapshot-primary',
          title: params.title,
          chartType: params.chartPreview.chartType,
          chartOptions: params.chartPreview.chartOptions,
          chartData: params.chartPreview.chartData,
          chartQuery: params.chartPreview.chartQuery,
        },
      ]
    : [];

  return {
    schemaVersion: 1,
    assetType: 'insight',
    narrative: {
      title: params.title,
      description: params.description,
      questionTitle: params.questionTitle,
      answerExcerpt: params.excerpt,
    },
    visuals: {
      widgets,
      layout: widgets.length ? [{ i: 'snapshot-primary', x: 0, y: 0, w: 12, h: 8 }] : [],
    },
    provenance: {
      sourcePath: '/chat',
      conversationId: params.conversationId,
      messageId: params.messageId,
    },
    capturedAt: new Date().toISOString(),
  };
}

export function snapshotWidgetsFromPayload(payload?: FeedSnapshotPayload | Record<string, unknown> | null): WidgetInstance[] {
  if (!payload || typeof payload !== 'object') return [];
  const visuals = (payload as FeedSnapshotPayload).visuals;
  if (!visuals?.widgets?.length) return [];
  return visuals.widgets.map((w) => ({
    id: w.id,
    title: w.title || 'Widget',
    chartType: (w.chartType || 'bar') as WidgetInstance['chartType'],
    chartOptions: w.chartOptions,
    chartData: w.chartData,
    chartQuery: w.chartQuery,
    isLoading: false,
    error: null,
  }));
}

export function snapshotLayoutFromPayload(payload?: FeedSnapshotPayload | Record<string, unknown> | null): LayoutItem[] {
  if (!payload || typeof payload !== 'object') return [];
  const visuals = (payload as FeedSnapshotPayload).visuals;
  return (visuals?.layout || []) as LayoutItem[];
}
