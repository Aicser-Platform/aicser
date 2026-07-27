/**
 * Shared pin path: upsert a library chart, then link (or copy) onto a dashboard.
 * Used by Chat, Query Editor, Chart Designer, and dashboard import flows.
 *
 * Layout placement is always resolved against the **target** dashboard's live
 * chart grid (not the active studio layout) so pins never stack on neighbors.
 */

import { chartBuilderService } from '@/app/(dashboard)/chart-designer/services/chartBuilderService';
import { chartService } from '@/app/(dashboard)/dashboards/services/chartService';
import type { ChartQuery } from '@/app/(dashboard)/dashboards/services/chartService';
import { prepareChartOptionsForPersist } from '@/components/charts/chartDesignerBridge';
import { placePinnedLayoutItem } from '@/app/(dashboard)/dashboards/utils/layoutSanitize';
import type { LayoutItem } from '@/app/(dashboard)/dashboards/stores/dashboardStoreTypes';
import { useProjectStore } from '@/stores/useProjectStore';

export type LibraryPinMode = 'link' | 'copy';

export type LibraryChartDefinition = {
  title: string;
  chartType: string;
  dataSourceId?: string | null;
  chartQuery?: ChartQuery | Record<string, unknown>;
  chartOptions?: Record<string, unknown>;
  /** When set, reuse an existing library chart with this saved_query_id */
  reuseSavedQuery?: boolean;
  /** Existing library / designer chart id — skip create and just link/copy */
  existingChartId?: string | null;
};

export type PinToDashboardResult = {
  chartId: string;
  libraryChartId: string;
  linked: boolean;
  copied: boolean;
};

/** Load target dashboard grid so placement never uses a stale/wrong board layout. */
async function loadTargetDashboardLayout(dashboardId: string): Promise<LayoutItem[]> {
  try {
    const charts = await chartService.listCharts(dashboardId);
    return (charts || []).map(
      (c: { layout?: { x?: number; y?: number; w?: number; h?: number; page_id?: string } }) => ({
        i: String((c as { id?: string }).id || Math.random()),
        x: Number(c.layout?.x) || 0,
        y: Number(c.layout?.y) || 0,
        w: Number(c.layout?.w) || 6,
        h: Number(c.layout?.h) || 5,
        ...(c.layout?.page_id ? { pageId: String(c.layout.page_id) } : {}),
      }),
    );
  } catch {
    return [];
  }
}

/**
 * Ensure a project/user-scoped library chart exists, then place it on a dashboard.
 * Default mode is link (shared definition). Pass mode:'copy' for an independent row.
 */
export async function ensureLibraryChartAndPinToDashboard(opts: {
  dashboardId: string;
  definition: LibraryChartDefinition;
  layout?: Partial<LayoutItem>;
  /** Optional hint; target board layout is always re-fetched for collision safety */
  existingLayout?: LayoutItem[];
  mode?: LibraryPinMode;
  projectId?: string | number | null;
}): Promise<PinToDashboardResult> {
  const mode = opts.mode || 'link';
  const projectId =
    opts.projectId ?? useProjectStore.getState().currentProjectId ?? null;

  const existingLayout =
    (await loadTargetDashboardLayout(opts.dashboardId)) || opts.existingLayout || [];
  const layout = placePinnedLayoutItem(existingLayout, {
    x: opts.layout?.x,
    y: opts.layout?.y,
    w: opts.layout?.w ?? 6,
    h: opts.layout?.h ?? 5,
    pageId: opts.layout?.pageId,
  });

  let libraryChartId = opts.definition.existingChartId
    ? String(opts.definition.existingChartId)
    : '';

  if (!libraryChartId) {
    const created = await chartBuilderService.createChart(
      {
        title: opts.definition.title,
        chartType: opts.definition.chartType,
        dataSourceId: opts.definition.dataSourceId ?? null,
        chartQuery: opts.definition.chartQuery || {},
        chartOptions: prepareChartOptionsForPersist(opts.definition.chartOptions),
        reuseSavedQuery: Boolean(opts.definition.reuseSavedQuery),
      },
      projectId,
    );
    libraryChartId = created?.id ? String(created.id) : '';
    if (!libraryChartId) {
      throw new Error('Library chart create returned no id');
    }
  }

  if (mode === 'copy') {
    const copied = await chartService.linkChart(opts.dashboardId, {
      chartId: libraryChartId,
      mode: 'copy',
      layout,
    });
    return {
      chartId: String(copied.id),
      libraryChartId,
      linked: false,
      copied: true,
    };
  }

  const linked = await chartService.linkChart(opts.dashboardId, {
    chartId: libraryChartId,
    mode: 'link',
    layout,
  });
  return {
    chartId: String(linked.id),
    libraryChartId,
    linked: true,
    copied: false,
  };
}
