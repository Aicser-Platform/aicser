import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/dashboards';
import type { Dashboard, Chart } from '@/api/dashboards';

// ── Cache keys ────────────────────────────────────────────────────────────────

export const dashboardKeys = {
  all: ['dashboards'] as const,
  list: (projectId?: string | number | null) => ['dashboards', 'list', projectId ?? null] as const,
  detail: (id: string) => ['dashboards', id] as const,
  charts: (dashboardId: string) => ['dashboards', dashboardId, 'charts'] as const,
  chartData: (dashboardId: string, chartId: string) =>
    ['dashboards', dashboardId, 'charts', chartId, 'data'] as const,
};

// ── Dashboard reads ───────────────────────────────────────────────────────────

export const useDashboards = (projectId?: string | number | null) => {
  const { data, error, isLoading } = useQuery({
    queryKey: dashboardKeys.list(projectId),
    queryFn: () => api.listDashboards(projectId),
    select: (res) => res.dashboards,
  });
  return { dashboards: data ?? [], error, isLoading };
};

export const useDashboard = (id: string | null) => {
  const { data, error, isLoading } = useQuery({
    queryKey: dashboardKeys.detail(id!),
    queryFn: () => api.getDashboard(id!),
    enabled: !!id,
  });
  return { dashboard: data?.dashboard ?? null, charts: data?.charts ?? [], error, isLoading };
};

// ── Dashboard mutations ───────────────────────────────────────────────────────

export const useCreateDashboard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, projectId }: { payload: Partial<Dashboard>; projectId?: string | number | null }) =>
      api.createDashboard(payload, projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: dashboardKeys.all }),
  });
};

export const useUpdateDashboard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Dashboard> }) =>
      api.updateDashboard(id, payload),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: dashboardKeys.all });
      qc.invalidateQueries({ queryKey: dashboardKeys.detail(id) });
    },
  });
};

export const useDeleteDashboard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDashboard(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: dashboardKeys.all }),
  });
};

// ── Chart reads ───────────────────────────────────────────────────────────────

export const useCharts = (dashboardId: string | null) => {
  const { data, error, isLoading } = useQuery({
    queryKey: dashboardKeys.charts(dashboardId!),
    queryFn: () => api.listCharts(dashboardId!),
    enabled: !!dashboardId,
  });
  return { charts: data ?? [], error, isLoading };
};

export const useChartData = (dashboardId: string | null, chartId: string | null) => {
  const { data, error, isLoading } = useQuery({
    queryKey: dashboardKeys.chartData(dashboardId!, chartId!),
    queryFn: () => api.executeChart(dashboardId!, chartId!),
    enabled: !!dashboardId && !!chartId,
    select: (res) => res.data,
  });
  return { chartData: data ?? null, error, isLoading };
};

// ── Chart mutations ───────────────────────────────────────────────────────────

export const useCreateChart = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, payload }: { dashboardId: string; payload: Partial<Chart> }) =>
      api.createChart(dashboardId, payload),
    onSuccess: (_res, { dashboardId }) =>
      qc.invalidateQueries({ queryKey: dashboardKeys.charts(dashboardId) }),
  });
};

export const useUpdateChart = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      dashboardId,
      chartId,
      payload,
    }: {
      dashboardId: string;
      chartId: string;
      payload: Partial<Chart>;
    }) => api.updateChart(dashboardId, chartId, payload),
    onSuccess: (_res, { dashboardId, chartId }) => {
      qc.invalidateQueries({ queryKey: dashboardKeys.charts(dashboardId) });
      qc.invalidateQueries({ queryKey: dashboardKeys.chartData(dashboardId, chartId) });
    },
  });
};

export const useDeleteChart = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dashboardId, chartId }: { dashboardId: string; chartId: string }) =>
      api.deleteChart(dashboardId, chartId),
    onSuccess: (_res, { dashboardId }) =>
      qc.invalidateQueries({ queryKey: dashboardKeys.charts(dashboardId) }),
  });
};
