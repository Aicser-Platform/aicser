import { chartService } from '@/app/(dashboard)/dashboards/services/chartService';
import { chartsToWidgetsAndLayout } from '@/app/(dashboard)/dashboards/stores/useDashboardStore';
import {
  buildChartSnapshotPayload,
  buildDashboardSnapshotPayload,
  type FeedSnapshotPayload,
} from '@/app/(dashboard)/feed/utils/buildFeedSnapshotPayload';

/** Cap how many widgets get real data fetched for an attachment snapshot -
 * this is a reference preview, not the full dashboard; matches the same
 * "first 6" convention buildDashboardSnapshotPayload's own featuredWidgetIds
 * ranking already uses for what a preview surfaces. */
const MAX_SNAPSHOT_WIDGETS = 24;

/**
 * Captures a real, static snapshot of a dashboard/chart at the moment it's
 * attached to a post - reusing the exact same chart-fetch primitives
 * (chartService), record-to-widget mapping (chartsToWidgetsAndLayout), and
 * snapshot-shape builder (buildDashboardSnapshotPayload /
 * buildChartSnapshotPayload) the normal "Publish to Feed" flow already uses
 * from the Dashboards builder and Chart Designer - not a second,
 * independent implementation.
 *
 * Why this exists: an attachment with no captured snapshot renders "live" -
 * every single viewer's page load re-fetches and re-executes that
 * dashboard's queries from scratch. A feed page showing several such
 * attachments at once was exhausting the server's DB connection pool
 * platform-wide (unrelated requests started timing out). Paying the fetch
 * cost ONCE here, by the author, at attach time, means every later view -
 * regardless of how large the organization is or how many times the post is
 * seen - is a cheap read of already-computed data instead of a fresh query.
 *
 * Failures here are non-fatal by design: attaching should never be blocked
 * by a slow/broken chart query. On any error this returns null and the
 * attachment falls back to the existing live-render path (still correct,
 * just not pre-computed).
 */
export async function buildDashboardAttachmentSnapshot(
  dashboardId: string,
  title: string,
): Promise<FeedSnapshotPayload | null> {
  try {
    const charts = await chartService.listCharts(dashboardId);
    if (!charts.length) return null;

    const { widgets, layout } = chartsToWidgetsAndLayout(charts);
    const capped = widgets.slice(0, MAX_SNAPSHOT_WIDGETS);
    const cappedIds = new Set(capped.map((w) => w.id));
    const cappedLayout = layout.filter((item) => cappedIds.has(item.i));

    await Promise.all(
      capped.map(async (widget) => {
        if (!widget.chartId) return;
        try {
          const execution = await chartService.executeChart(dashboardId, widget.chartId);
          widget.chartData = execution.data;
        } catch {
          // One widget's query failing shouldn't drop the whole snapshot -
          // it just renders without data for that one chart, same as a live
          // view where a single widget's fetch fails.
        }
      }),
    );

    return buildDashboardSnapshotPayload({
      dashboardId,
      title,
      widgets: capped,
      layout: cappedLayout,
    });
  } catch {
    return null;
  }
}

/** Same idea as buildDashboardAttachmentSnapshot, for a single standalone chart. */
export async function buildChartAttachmentSnapshot(
  dashboardId: string,
  chartId: string,
  title: string,
): Promise<FeedSnapshotPayload | null> {
  try {
    const [chart, execution] = await Promise.all([
      chartService.getChart(dashboardId, chartId),
      chartService.executeChart(dashboardId, chartId).catch(() => null),
    ]);
    return buildChartSnapshotPayload({
      title,
      chartWidget: {
        chartType: chart.chartType,
        chartOptions: chart.chartOptions,
        chartData: execution?.data,
        chartQuery: chart.chartQuery,
      },
      dashboardId,
      chartId,
    });
  } catch {
    return null;
  }
}
