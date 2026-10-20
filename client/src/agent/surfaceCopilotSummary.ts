import type { SurfaceContext } from '@/agent/surfaceContext';
import { buildSurfaceDataConnectivity } from '@/agent/surfaceDataConnectivity';
import { sheetCopilotContextSummary } from '@/agent/sheetCopilotSummary';

export function surfaceCopilotContextSummary(ctx: SurfaceContext): string | null {
  const connectivity = ctx.runtime?.data_connectivity ?? buildSurfaceDataConnectivity(ctx);
  if (ctx.surface === 'sheet') {
    const sheet = sheetCopilotContextSummary(ctx);
    if (connectivity.can_analyze_without_sidebar_source) {
      return sheet ? `${sheet} · ${connectivity.summary}` : connectivity.summary;
    }
    return sheet;
  }
  if (ctx.surface === 'notebook') {
    if (connectivity.can_analyze_without_sidebar_source) {
      return connectivity.summary;
    }
    return 'Notebook open — add SQL or Python cells for deeper analysis';
  }
  if (ctx.surface === 'dashboard') {
    if (connectivity.can_analyze_without_sidebar_source) {
      return connectivity.summary;
    }
    return 'Dashboard studio — add widgets or connect a data source';
  }
  return null;
}
