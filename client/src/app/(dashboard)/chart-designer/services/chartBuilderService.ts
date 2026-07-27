import { fetchApi } from '@/utils/api';
import type { ChartQuery } from '../../dashboards/services/chartService';

/**
 * Standalone chart-builder service.
 *
 * Sibling to the dashboard `chartService`, but for **dashboard-less** charts driven by
 * the chart designer (`/chart-designer`). It owns one responsibility: CRUD + ad-hoc
 * execution against the standalone `/api/chart*` endpoints, and it centralizes the
 * CE/EE ownership scoping:
 *   - CE: charts are tracked by the authenticated `user_id` (no project param sent).
 *   - EE: charts are tracked by `project_id` (a valid project must be selected).
 */

const IS_ENTERPRISE_EDITION =
  process.env.NEXT_PUBLIC_EDITION === 'enterprise' || process.env.EDITION === 'enterprise';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns a valid project UUID on EE, or `null` (CE always returns `null`). */
export function normalizeProjectId(projectId?: string | number | null): string | null {
  if (!IS_ENTERPRISE_EDITION) return null;
  if (projectId == null) return null;
  const value = String(projectId);
  return UUID_PATTERN.test(value) ? value : null;
}

/** Thrown when an EE user tries to create/list charts without a selected project. */
export class ProjectRequiredError extends Error {
  constructor(message = 'Select a project before working with charts.') {
    super(message);
    this.name = 'ProjectRequiredError';
  }
}

export interface StandaloneChartWritePayload {
  title?: string;
  chartType: string;
  dataSourceId?: string | null;
  chartQuery?: ChartQuery | Record<string, unknown>;
  chartOptions?: Record<string, unknown>;
  dashboardId?: string;
}

export interface StandaloneChartExecutePayload {
  chartType: string;
  dataSourceId?: string | null;
  chartQuery?: ChartQuery | Record<string, unknown>;
}

/** Raw serialized standalone chart as returned by the backend. */
export type StandaloneChartResponse = Record<string, unknown> & { id: string };

class ChartBuilderService {
  /** `chart` on CE, `chart?project_id=<uuid>` on EE. */
  private collectionEndpoint(projectId?: string | number | null): string {
    const pid = normalizeProjectId(projectId);
    return pid ? `chart?project_id=${encodeURIComponent(pid)}` : 'chart';
  }

  /** Throws on EE when no valid project is selected; returns the project UUID (or null on CE). */
  private requireScope(projectId?: string | number | null): string | null {
    const pid = normalizeProjectId(projectId);
    if (IS_ENTERPRISE_EDITION && !pid) {
      throw new ProjectRequiredError();
    }
    return pid;
  }

  /** List charts for the current scope (CE: user's; EE: project's). */
  async listCharts(
    projectId?: string | number | null,
    opts?: {
      q?: string;
      facet?: string;
      collectionId?: string;
      limit?: number;
      offset?: number;
      detail?: 'summary' | 'full';
    },
  ): Promise<StandaloneChartResponse[]> {
    const pid = this.requireScope(projectId);
    const params = new URLSearchParams();
    if (pid) params.set('project_id', pid);
    params.set('limit', String(opts?.limit ?? 200));
    params.set('offset', String(opts?.offset ?? 0));
    params.set('detail', opts?.detail ?? 'full');
    if (opts?.q) params.set('q', opts.q);
    if (opts?.facet) params.set('facet', opts.facet);
    if (opts?.collectionId) params.set('collection_id', opts.collectionId);
    const data = await fetchApi<{ success?: boolean; charts?: StandaloneChartResponse[] }>(
      `chart?${params.toString()}`,
    );
    return Array.isArray(data?.charts) ? data.charts : [];
  }

  /** Create a new standalone chart (or reuse by saved_query_id when reuseSavedQuery). */
  async createChart(
    payload: StandaloneChartWritePayload & {
      reuseSavedQuery?: boolean;
      collectionId?: string | null;
      tags?: string[];
    },
    projectId?: string | number | null,
  ): Promise<StandaloneChartResponse> {
    const pid = this.requireScope(projectId);
    return await fetchApi<StandaloneChartResponse>(this.collectionEndpoint(pid), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /** Update an existing standalone chart. */
  async updateChart(
    chartId: string,
    payload: Partial<StandaloneChartWritePayload>,
  ): Promise<StandaloneChartResponse> {
    return await fetchApi<StandaloneChartResponse>(`chart/${chartId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  /** Fetch a single standalone chart. */
  async getChart(chartId: string): Promise<StandaloneChartResponse> {
    return await fetchApi<StandaloneChartResponse>(`chart/${chartId}`);
  }

  /** Delete a standalone chart. */
  async deleteChart(chartId: string): Promise<void> {
    await fetchApi(`chart/${chartId}`, { method: 'DELETE' });
  }

  /**
   * Execute a chart query without persisting it — used for live preview while the
   * user configures a chart. On EE the project is threaded through the body so the
   * backend can enforce project-scoped permissions.
   */
  async executeAdhoc(
    payload: StandaloneChartExecutePayload,
    projectId?: string | number | null,
  ): Promise<{ data: unknown }> {
    const pid = normalizeProjectId(projectId);
    const body: Record<string, unknown> = { ...payload };
    if (pid) body.projectId = pid;
    return await fetchApi<{ data: unknown }>('chart/execute', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}

export const chartBuilderService = new ChartBuilderService();
