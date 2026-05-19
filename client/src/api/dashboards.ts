import { fetchApi } from '@/utils/api';

export interface Dashboard {
  id: string;
  title: string;
  project_id?: string | number | null;
  config?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface Chart {
  id: string;
  dashboard_id: string;
  title?: string;
  chart_type?: string;
  data_source_id?: string | null;
  query?: Record<string, any>;
  options?: Record<string, any>;
  position?: { x: number; y: number; w: number; h: number };
  created_at?: string;
  updated_at?: string;
}

// ── Dashboards ────────────────────────────────────────────────────────────────

export const listDashboards = (projectId?: string | number | null): Promise<{ dashboards: Dashboard[] }> =>
  fetchApi(projectId ? `dashboards?project_id=${projectId}` : 'dashboards');

export const getDashboard = (id: string): Promise<{ dashboard: Dashboard; charts?: Chart[] }> =>
  fetchApi(`dashboards/${id}`);

export const createDashboard = (
  payload: Partial<Dashboard>,
  projectId?: string | number | null,
): Promise<Dashboard> =>
  fetchApi(projectId ? `dashboards?project_id=${projectId}` : 'dashboards', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateDashboard = (id: string, payload: Partial<Dashboard>): Promise<Dashboard> =>
  fetchApi(`dashboards/${id}`, { method: 'PUT', body: JSON.stringify(payload) });

export const deleteDashboard = (id: string): Promise<void> =>
  fetchApi(`dashboards/${id}`, { method: 'DELETE' });

// ── Charts ────────────────────────────────────────────────────────────────────

export const listCharts = (dashboardId: string): Promise<Chart[]> =>
  fetchApi(`dashboards/${dashboardId}/charts`);

export const createChart = (dashboardId: string, payload: Partial<Chart>): Promise<Chart> =>
  fetchApi(`dashboards/${dashboardId}/charts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateChart = (dashboardId: string, chartId: string, payload: Partial<Chart>): Promise<Chart> =>
  fetchApi(`dashboards/${dashboardId}/charts/${chartId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export const deleteChart = (dashboardId: string, chartId: string): Promise<void> =>
  fetchApi(`dashboards/${dashboardId}/charts/${chartId}`, { method: 'DELETE' });

export const executeChart = (dashboardId: string, chartId: string): Promise<{ data: any }> =>
  fetchApi(`dashboards/${dashboardId}/charts/${chartId}/data`);

export const updateChartLayout = (
  dashboardId: string,
  chartId: string,
  position: { x: number; y: number; w: number; h: number },
): Promise<Chart> =>
  fetchApi(`dashboards/${dashboardId}/charts/${chartId}`, {
    method: 'PUT',
    body: JSON.stringify({ position }),
  });
