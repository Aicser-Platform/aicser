import type { ChartData } from '../services/chartService';
import type { RuntimeFilter } from '../utils/filterOperators';
import { mergeFilterConfigs } from '../utils/filterConfigMerge';
import { resolveRuntimeFiltersForWidget } from '../utils/filterOperators';
import type { DashboardFilter } from '@/types/dashboard';

export type WidgetType =
  | 'pie'
  | 'line'
  | 'area'
  | 'bar'
  | 'table'
  | 'scatter'
  | 'funnel'
  | 'heatmap'
  | 'stat'
  | 'text'
  | 'slicer'
  | 'donut'
  | 'gauge'
  | 'treemap'
  | 'waterfall'
  | 'bullet'
  | 'divider'
  | 'image'
  | 'geo'
  | 'embed';

const NON_DATA_WIDGET_TYPES = new Set<string>(['text', 'slicer', 'divider', 'image', 'embed']);

export function isNonDataWidget(chartType?: string): boolean {
  return NON_DATA_WIDGET_TYPES.has(chartType || '');
}

export type LayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pageId?: string;
};

export type WidgetInstance = {
  id: string;
  dataSourceId?: string;
  title: string;
  chartType: WidgetType;
  chartQuery?: {
    x?: string;
    aggregate?: boolean;
    yMetric?: 'count' | 'sum' | 'none' | 'distinct_count' | 'avg' | 'min' | 'max';
    xMetrics?: { field: string; aggregation: string }[];
    yMetrics?: { field: string; aggregation: string }[];
    yMetricsSecondary?: { field: string; aggregation: string }[];
    y?: string;
    legend?: string;
    sortBy?: string;
    filters?: {
      field: string;
      operator: string;
      value: unknown;
      type: 'simple' | 'sql';
      sql?: string;
    }[];
    metricFilters?: {
      field: string;
      aggregation: string;
      operator: string;
      value: unknown;
    }[];
    tableName?: string;
    field?: string;
    mode?: 'single' | 'multi';
    dataSourceId?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    seriesLimit?: number;
    drillPath?: string[];
    interactionMode?: 'drill' | 'cross_filter';
    drillThrough?: {
      targetPageId: string;
      filterField?: string;
    };
  };
  chartOptions?: Record<string, unknown>;
  chartId?: string;
  chartData?: ChartData;
  isLoading?: boolean;
  error?: string | null;
  lastFetchedQueryHash?: string;
  isLocked?: boolean;
  /** Client-only LWW timestamp for collaborative edits */
  collabTs?: number;
};

export interface Dashboard {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  config?: Record<string, unknown>;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
}

export type StudioMode = 'edit' | 'view';

export interface DashboardVersion {
  id: string;
  dashboardId: string;
  label: string;
  savedAt: number;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
}

export function scopedFiltersForWidget(
  state: {
    runtimeFilters: RuntimeFilter[];
    globalFiltersConfig: DashboardFilter[];
    pageFiltersConfig: DashboardFilter[];
  },
  widget: WidgetInstance,
): RuntimeFilter[] {
  const configs = mergeFilterConfigs(state.globalFiltersConfig, state.pageFiltersConfig);
  return resolveRuntimeFiltersForWidget(state.runtimeFilters, configs, widget);
}

export type { RuntimeFilter };
