import { fetchApi } from '@/utils/api';

const DASHBOARDS_BASE = 'dashboards';

export interface ChartQuery {
  x?: string;
  aggregate?: boolean;
  yMetric?: 'count' | 'sum' | 'none' | 'distinct_count' | 'avg' | 'min' | 'max';
  yMetrics?: { field: string; aggregation: string }[];
  yMetricsSecondary?: { field: string; aggregation: string }[];
  groupBy?: boolean;
  groupField?: string;
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

export interface DashboardPayload {
  title: string;
  config?: Record<string, any>;
}

export interface DashboardResponse {
  id: string;
  title: string;
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

class ChartService {
  private async authenticatedFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
    return fetchApi(endpoint, options);
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

  async listDashboards(projectId?: string | number | null): Promise<DashboardResponse[]> {
    const url = projectId ? `${DASHBOARDS_BASE}?project_id=${projectId}` : DASHBOARDS_BASE;
    const data = await this.authenticatedFetch(url, { method: 'GET' });
    return data.dashboards || [];
  }

  async getDashboard(dashboardId: string): Promise<DashboardResponse> {
    return await this.authenticatedFetch(`${DASHBOARDS_BASE}/${dashboardId}`, { method: 'GET' });
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
    return await this.authenticatedFetch(`charts/dashboards/from-template`, {
      method: 'POST',
      body: JSON.stringify({
        template_id: payload.templateId,
        project_id: payload.projectId != null ? String(payload.projectId) : undefined,
        dashboard_name: payload.dashboardName,
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
      };
    }
  ): Promise<Chart> {
    return await this.authenticatedFetch(this.getChartsEndpoint(dashboardId), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getChart(dashboardId: string, chartId: string): Promise<Chart> {
    return await this.authenticatedFetch(`${this.getChartsEndpoint(dashboardId)}/${chartId}`, {
      method: 'GET',
    });
  }

  async listCharts(dashboardId: string): Promise<Chart[]> {
    const data = await this.authenticatedFetch(this.getChartsEndpoint(dashboardId), { method: 'GET' });
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

  async executeChart(dashboardId: string, chartId: string): Promise<ChartExecutionResponse> {
    return await this.authenticatedFetch(`${this.getChartsEndpoint(dashboardId)}/${chartId}/data`, {
      method: 'GET',
    });
  }

  async updateChartLayout(
    dashboardId: string,
    chartId: string,
    layout: { x: number; y: number; w: number; h: number }
  ): Promise<void> {
    await this.authenticatedFetch(`${this.getChartsEndpoint(dashboardId)}/${chartId}/layout`, {
      method: 'PUT',
      body: JSON.stringify(layout),
    });
  }
}

export const chartService = new ChartService();
