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
    presentation?: {
      featuredWidgetIds?: string[];
      colorPalette?: string;
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
  colorPalette?: string;
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
    colorPalette,
  } = params;
  const positionById = new Map(layout.map((item) => [item.i, item]));
  const featuredWidgetIds = [...widgets]
    .sort((left, right) => {
      const score = (widget: WidgetInstance) => {
        const position = positionById.get(widget.id);
        const typeScore =
          widget.chartType === 'stat'
            ? 5
            : ['line', 'area', 'bar', 'pie', 'donut', 'gauge'].includes(widget.chartType)
              ? 4
              : widget.chartType === 'table'
                ? 2
                : 1;
        const dataScore = widget.chartData ? 2 : 0;
        const sizeScore = position ? Math.min(2, (position.w * position.h) / 24) : 0;
        return typeScore + dataScore + sizeScore;
      };
      const scoreDifference = score(right) - score(left);
      if (scoreDifference) return scoreDifference;
      const leftPosition = positionById.get(left.id);
      const rightPosition = positionById.get(right.id);
      return (leftPosition?.y ?? 0) - (rightPosition?.y ?? 0) || (leftPosition?.x ?? 0) - (rightPosition?.x ?? 0);
    })
    .slice(0, 6)
    .map((widget) => widget.id);

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
      presentation: {
        featuredWidgetIds,
        colorPalette,
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

export function snapshotWidgetsFromPayload(
  payload?: FeedSnapshotPayload | Record<string, unknown> | null
): WidgetInstance[] {
  if (!payload || typeof payload !== 'object') return [];
  const visuals = (payload as FeedSnapshotPayload).visuals;
  if (!visuals?.widgets?.length) return [];
  return visuals.widgets.map((w) => ({
    id: w.id,
    title: w.title || 'Widget',
    chartType: (w.chartType || 'bar') as WidgetInstance['chartType'],
    chartOptions: {
      ...(w.chartOptions || {}),
      ...(visuals.presentation?.colorPalette && !w.chartOptions?.colorPalette
        ? {
            colorPalette: visuals.presentation.colorPalette,
            dashboardDefaultPalette: visuals.presentation.colorPalette,
          }
        : {}),
    },
    chartData: w.chartData,
    chartQuery: w.chartQuery,
    isLoading: false,
    error: null,
  }));
}

export function snapshotLayoutFromPayload(
  payload?: FeedSnapshotPayload | Record<string, unknown> | null
): LayoutItem[] {
  if (!payload || typeof payload !== 'object') return [];
  const visuals = (payload as FeedSnapshotPayload).visuals;
  return (visuals?.layout || []) as LayoutItem[];
}
