import { fetchApi } from '@/utils/api';
import { normalizeRuntimeFiltersForBackend } from '../utils/filterOperators';
import { sanitizeLayoutItem } from '../utils/layoutSanitize';

const DASHBOARDS_BASE = 'dashboards';

export interface ChartQuery {
  x?: string;
  /** Date bucketing for X: year | quarter | month | week | day | hour */
  xGrain?: string;
  aggregate?: boolean;
  yMetric?: 'count' | 'sum' | 'none' | 'distinct_count' | 'avg' | 'min' | 'max' | 'mean';
  yMetrics?: { field: string; aggregation: string }[];
  yMetricsSecondary?: { field: string; aggregation: string }[];
  xMetrics?: { field: string; aggregation: string }[];
  groupBy?: boolean;
  groupField?: string;
  legend?: string;
  groupSortBy?: 'field' | 'order';
  groupOrder?: 'asc' | 'desc';
  sortBy?: string;
  filters?: {
    field: string;
    operator: string;
    value: any;
    type: 'simple' | 'sql';
    sql?: string;
  }[];
  metricFilters?: {
    field: string;
    aggregation: string;
    operator: string;
    value: any;
  }[];
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  seriesLimit?: number;
  joins?: {
    table: string;
    alias?: string;
    on: { left: string; right: string } | string;
    type: string;
    relationshipId?: string;
    modelJoin?: boolean;
  }[];
  /** Drill hierarchy / additional category dimensions beyond X + Legend */
  drillPath?: string[];
  interactionMode?: 'drill' | 'cross_filter';
  drillThrough?: {
    targetPageId: string;
    filterField?: string;
  };
  tableName?: string;
  saved_query_id?: string | number;
  query_snapshot_id?: string | number;
}

export interface Chart {
  id: string;
  dataSourceId: string | null;
  chartType: string;
  title?: string;
  chartQuery?: ChartQuery;
  chartOptions?: Record<string, any>;
}

export interface ChartData {
  x: (string | number)[];
  y: (string | number)[];
  series?: { name: string; data: any[] }[];
  secondarySeries?: { name: string; data: any[] }[];
}

export interface ChartExecutionResponse {
  chart: Chart;
  data: ChartData;
}

export interface BatchChartRefreshItem {
  chart_id: string;
  widget_id?: string;
  runtime_filters?: Array<{ field: string; operator: string; value: unknown; type?: string }>;
  drill_context?: {
    level: number;
    drill_path: string[];
    drill_filters: Array<{ field: string; operator: string; value: unknown }>;
  };
}

export interface BatchChartRefreshResult {
  chart_id: string;
  widget_id?: string;
  success: boolean;
  data?: ChartData;
  error?: string;
}

export interface BatchChartRefreshResponse {
  results: BatchChartRefreshResult[];
  ok: number;
  failed: number;
  total: number;
}

export interface DashboardPayload {
  title: string;
  description?: string;
  config?: Record<string, any>;
}

export interface DashboardResponse {
  id: string;
  title: string;
  description?: string;
  config?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardTemplateWidget {
  name: string;
  chart_type: string;
  sample_sql?: string;
}

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  domain: string;
  default_dashboard_name: string;
  widgets: DashboardTemplateWidget[];
}

export interface CreateDashboardFromTemplatePayload {
  templateId: string;
  projectId?: string | number | null;
  dashboardName?: string;
}

export type DashboardAccessOptions = { embedToken?: string };

/** List-endpoint shape — omits the widgets/layout payload to keep the list light. */
export interface DashboardVersionSummaryResponse {
  id: string;
  dashboardId: string;
  label: string;
  savedAt: number | null;
  widgetCount: number;
}

/** Single-version shape (create/get) — includes the full widgets/layout snapshot. */
export interface DashboardVersionFullResponse {
  id: string;
  dashboardId: string;
  label: string;
  savedAt: number | null;
  widgets: unknown[];
  layout: unknown[];
}

class ChartService {
  private async authenticatedFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
    return fetchApi(endpoint, options);
  }

  private withAccessQuery(path: string, opts?: DashboardAccessOptions): string {
    if (!opts?.embedToken) return path;
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}token=${encodeURIComponent(opts.embedToken)}`;
  }

  private getChartsEndpoint(dashboardId: string) {
    return `${DASHBOARDS_BASE}/${dashboardId}/charts`;
  }

  /* =========================================================
   * Dashboard Management
   * =======================================================*/

  async createDashboard(payload: DashboardPayload, project_id?: string | number | null): Promise<DashboardResponse> {
    const url = project_id ? `${DASHBOARDS_BASE}?project_id=${project_id}` : DASHBOARDS_BASE;
    return await this.authenticatedFetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async listDashboards(
    projectId?: string | number | null,
    opts?: {
      q?: string;
      facet?: string;
      collectionId?: string | null;
      limit?: number;
      offset?: number;
      detail?: 'summary' | 'full';
    },
  ): Promise<DashboardResponse[]> {
    const params = new URLSearchParams();
    if (projectId != null && projectId !== '') params.set('project_id', String(projectId));
    if (opts?.q) params.set('q', opts.q);
    if (opts?.facet) params.set('facet', opts.facet);
    if (opts?.collectionId) params.set('collection_id', opts.collectionId);
    params.set('limit', String(opts?.limit ?? 100));
    params.set('offset', String(opts?.offset ?? 0));
    params.set('detail', opts?.detail ?? 'summary');
    const qs = params.toString();
    const data = await this.authenticatedFetch(`${DASHBOARDS_BASE}?${qs}`, { method: 'GET' });
    return data.dashboards || [];
  }

  async listDashboardsPage(
    projectId?: string | number | null,
    opts?: {
      q?: string;
      facet?: string;
      collectionId?: string | null;
      limit?: number;
      offset?: number;
      detail?: 'summary' | 'full';
    },
  ): Promise<{
    dashboards: DashboardResponse[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }> {
    const { dashboardLibraryService } = await import('./dashboardLibraryService');
    const page = await dashboardLibraryService.list({
      projectId,
      q: opts?.q,
      facet: (opts?.facet as any) || 'all',
      collectionId: opts?.collectionId,
      limit: opts?.limit,
      offset: opts?.offset,
      detail: opts?.detail,
    });
    return {
      dashboards: page.dashboards as unknown as DashboardResponse[],
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
    };
  }

  async getDashboard(dashboardId: string, opts?: DashboardAccessOptions): Promise<DashboardResponse> {
    return await this.authenticatedFetch(this.withAccessQuery(`${DASHBOARDS_BASE}/${dashboardId}`, opts), {
      method: 'GET',
    });
  }

  async getDashboardBuildProgress(dashboardId: string): Promise<Record<string, unknown>> {
    return await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/build-progress`, {
      method: 'GET',
    });
  }

  /** SSE stream — same dashboard event types as /chat analyze. */
  async subscribeDashboardBuildProgress(
    dashboardId: string,
    onEvent: (data: unknown) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const { consumeDashboardBuildSSE } = await import('../utils/consumeDashboardBuildSSE');
    await consumeDashboardBuildSSE(dashboardId, onEvent, signal);
  }

  async updateDashboard(dashboardId: string, payload: Partial<DashboardPayload>): Promise<DashboardResponse> {
    return await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteDashboard(dashboardId: string): Promise<void> {
    await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}`, { method: 'DELETE' });
  }

  async getDashboardTemplates(): Promise<DashboardTemplate[]> {
    const result = await this.authenticatedFetch(`charts/dashboards/templates`, { method: 'GET' });
    return Array.isArray(result?.templates) ? result.templates : [];
  }

  async createDashboardFromTemplate(payload: CreateDashboardFromTemplatePayload): Promise<any> {
    // The backend's single Pydantic body param is (for reasons not yet root-caused —
    // isolated FastAPI repros with the same signature shape don't reproduce it) actually
    // requiring the body embedded under its own param name, contradicting both FastAPI's
    // documented default and this endpoint's own integration test. Verified empirically
    // via direct curl against the live server: flat body -> 422, embedded -> 200.
    return await this.authenticatedFetch(`charts/dashboards/from-template`, {
      method: 'POST',
      body: JSON.stringify({
        request_payload: {
          template_id: payload.templateId,
          project_id: payload.projectId != null ? String(payload.projectId) : undefined,
          dashboard_name: payload.dashboardName,
        },
      }),
    });
  }

  /* =========================================================
   * Chart Management
   * =======================================================*/

  async createChart(
    dashboardId: string,
    payload: {
      dataSourceId: string | null;
      chartType: string;
      title?: string;
      chartQuery?: ChartQuery;
      chartOptions?: Record<string, any>;
      layout?: {
        x: number;
        y: number;
        w: number;
        h: number;
        pageId?: string;
        page_id?: string;
      };
    }
  ): Promise<Chart> {
    const body = { ...payload };
    if (payload.layout) {
      body.layout = sanitizeLayoutItem(payload.layout);
    }
    return await this.authenticatedFetch(this.getChartsEndpoint(dashboardId), {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Place an existing library chart on a dashboard (shared instance).
   * Pass mode: 'copy' to create an independent duplicate instead.
   */
  async linkChart(
    dashboardId: string,
    payload: {
      chartId: string;
      mode?: 'link' | 'copy';
      layout?: {
        x: number;
        y: number;
        w: number;
        h: number;
        pageId?: string;
        page_id?: string;
      };
    },
  ): Promise<Chart & { linked?: boolean; created?: boolean; copied?: boolean }> {
    const body: Record<string, unknown> = {
      chartId: payload.chartId,
      mode: payload.mode || 'link',
    };
    if (payload.layout) {
      body.layout = sanitizeLayoutItem(payload.layout);
    }
    return await this.authenticatedFetch(`${this.getChartsEndpoint(dashboardId)}/link`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async unlinkChart(dashboardId: string, chartId: string): Promise<void> {
    await this.authenticatedFetch(`${this.getChartsEndpoint(dashboardId)}/${chartId}/link`, {
      method: 'DELETE',
    });
  }

  async getChart(dashboardId: string, chartId: string): Promise<Chart> {
    return await this.authenticatedFetch(`${this.getChartsEndpoint(dashboardId)}/${chartId}`, {
      method: 'GET',
    });
  }

  async listCharts(dashboardId: string, opts?: DashboardAccessOptions): Promise<Chart[]> {
    const data = await this.authenticatedFetch(this.withAccessQuery(this.getChartsEndpoint(dashboardId), opts), {
      method: 'GET',
    });
    return Array.isArray(data) ? data : [];
  }

  async updateChart(dashboardId: string, chartId: string, payload: Partial<Chart>): Promise<Chart> {
    return await this.authenticatedFetch(`${this.getChartsEndpoint(dashboardId)}/${chartId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteChart(dashboardId: string, chartId: string): Promise<void> {
    await this.authenticatedFetch(`${this.getChartsEndpoint(dashboardId)}/${chartId}`, {
      method: 'DELETE',
    });
  }

  async executeChart(
    dashboardId: string,
    chartId: string,
    opts?: DashboardAccessOptions
  ): Promise<ChartExecutionResponse> {
    return await this.authenticatedFetch(
      this.withAccessQuery(`${this.getChartsEndpoint(dashboardId)}/${chartId}/data`, opts),
      { method: 'GET' }
    );
  }

  async executeChartWithFilters(
    dashboardId: string,
    chartId: string,
    runtimeFilters: Array<{ field: string; operator: string; value: unknown; type?: string }>,
    opts?: DashboardAccessOptions & {
      drillContext?: BatchChartRefreshItem['drill_context'];
    }
  ): Promise<ChartExecutionResponse> {
    const normalized = normalizeRuntimeFiltersForBackend(runtimeFilters);
    const body: Record<string, unknown> = { runtime_filters: normalized };
    if (opts?.drillContext) {
      body.drill_context = opts.drillContext;
    }
    return await this.authenticatedFetch(
      this.withAccessQuery(`${this.getChartsEndpoint(dashboardId)}/${chartId}/data`, opts),
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  }

  async refreshDashboardCharts(
    dashboardId: string,
    charts: BatchChartRefreshItem[],
    opts?: { embedToken?: string }
  ): Promise<BatchChartRefreshResponse> {
    const qs = opts?.embedToken ? `?token=${encodeURIComponent(opts.embedToken)}` : '';
    const payload = {
      charts: charts.map((item) => ({
        chart_id: item.chart_id,
        widget_id: item.widget_id,
        runtime_filters: item.runtime_filters?.length
          ? normalizeRuntimeFiltersForBackend(item.runtime_filters)
          : undefined,
        drill_context: item.drill_context,
      })),
    };
    return await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/refresh${qs}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async publishDashboardAccess(dashboardId: string, isPublic: boolean) {
    return await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ is_public: isPublic }),
    });
  }

  async listPages(dashboardId: string, opts?: DashboardAccessOptions) {
    const data = await this.authenticatedFetch(
      this.withAccessQuery(`${DASHBOARDS_BASE}/${dashboardId}/pages`, opts),
      { method: 'GET' }
    );
    return data.pages || [];
  }

  async createPage(dashboardId: string, name: string) {
    return await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/pages`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async updatePage(dashboardId: string, pageId: string, payload: Record<string, unknown>) {
    return await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/pages/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deletePage(dashboardId: string, pageId: string) {
    await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/pages/${pageId}`, { method: 'DELETE' });
  }

  async reorderPages(dashboardId: string, pageIds: string[]) {
    const data = await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/pages/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ page_ids: pageIds }),
    });
    return data.pages || pageIds.map((id, i) => ({ id, page_order: i }));
  }

  async setDefaultPage(dashboardId: string, pageId: string) {
    const dash = await this.getDashboard(dashboardId);
    return await this.updateDashboard(dashboardId, {
      config: { ...(dash.config || {}), default_page_id: pageId },
    });
  }

  async getFilterOptions(
    dashboardId: string,
    field: string,
    dataSourceId: string,
    opts?: {
      embedToken?: string;
      tableName?: string;
      runtimeFilters?: Array<{ field: string; operator: string; value: unknown; type?: string }>;
      excludeField?: string;
    }
  ) {
    const qs = new URLSearchParams({ field, data_source_id: dataSourceId });
    if (opts?.tableName) qs.set('table_name', opts.tableName);
    if (opts?.embedToken) qs.set('token', opts.embedToken);
    if (opts?.runtimeFilters?.length) {
      const normalized = normalizeRuntimeFiltersForBackend(
        opts.runtimeFilters.filter((f) => f.field !== (opts.excludeField || field))
      );
      if (normalized.length) {
        qs.set('runtime_filters', JSON.stringify(normalized));
      }
    }
    return await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/filter-options?${qs}`, {
      method: 'GET',
    });
  }

  async getFilterFieldStats(
    dashboardId: string,
    field: string,
    dataSourceId: string,
    opts?: {
      embedToken?: string;
      tableName?: string;
      runtimeFilters?: Array<{ field: string; operator: string; value: unknown; type?: string }>;
    }
  ): Promise<{ min?: number | string | null; max?: number | string | null }> {
    const qs = new URLSearchParams({ field, data_source_id: dataSourceId });
    if (opts?.tableName) qs.set('table_name', opts.tableName);
    if (opts?.embedToken) qs.set('token', opts.embedToken);
    if (opts?.runtimeFilters?.length) {
      const normalized = normalizeRuntimeFiltersForBackend(opts.runtimeFilters);
      if (normalized.length) qs.set('runtime_filters', JSON.stringify(normalized));
    }
    const res = await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/filter-field-stats?${qs}`, {
      method: 'GET',
    });
    if (res && typeof res === 'object') {
      const obj = res as { min?: number | string | null; max?: number | string | null };
      return { min: obj.min ?? null, max: obj.max ?? null };
    }
    return { min: null, max: null };
  }

  async updateChartLayout(
    dashboardId: string,
    chartId: string,
    layout: { x: number; y: number; w: number; h: number; page_id?: string; pageId?: string }
  ): Promise<void> {
    const safe = sanitizeLayoutItem(layout);
    await this.authenticatedFetch(`${this.getChartsEndpoint(dashboardId)}/${chartId}/layout`, {
      method: 'PUT',
      body: JSON.stringify(safe),
    });
  }

  /* =========================================================
   * Version History (server-backed named snapshots)
   * =======================================================*/

  async listVersions(dashboardId: string): Promise<DashboardVersionSummaryResponse[]> {
    const data = await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/versions`, {
      method: 'GET',
    });
    return Array.isArray(data?.versions) ? data.versions : [];
  }

  async createVersion(
    dashboardId: string,
    payload: { label?: string; config: Record<string, unknown> }
  ): Promise<DashboardVersionFullResponse> {
    return await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/versions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getVersion(dashboardId: string, versionId: string): Promise<DashboardVersionFullResponse> {
    return await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/versions/${versionId}`, {
      method: 'GET',
    });
  }

  async deleteVersion(dashboardId: string, versionId: string): Promise<void> {
    await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}/versions/${versionId}`, {
      method: 'DELETE',
    });
  }
}

export const chartService = new ChartService();
