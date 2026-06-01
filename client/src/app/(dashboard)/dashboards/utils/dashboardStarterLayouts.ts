import { LAYOUT_PRESETS } from '../components/LayoutPresetsMenu';
import type { LayoutItem, WidgetInstance, WidgetType } from '../stores/useDashboardStore';
import { generateWidgetId } from './buildDashboardWidget';

export type StarterLayoutKind = 'kpi' | 'executive';

type StarterSpec = { chartType: WidgetType; title: string };

const STARTER_WIDGETS: Record<StarterLayoutKind, StarterSpec[]> = {
  kpi: [
    { chartType: 'stat', title: 'KPI 1' },
    { chartType: 'stat', title: 'KPI 2' },
    { chartType: 'stat', title: 'KPI 3' },
    { chartType: 'bar', title: 'Trend or breakdown' },
  ],
  executive: [
    { chartType: 'stat', title: 'KPI 1' },
    { chartType: 'stat', title: 'KPI 2' },
    { chartType: 'stat', title: 'KPI 3' },
    { chartType: 'stat', title: 'KPI 4' },
    { chartType: 'bar', title: 'Primary chart' },
    { chartType: 'line', title: 'Trend chart' },
  ],
};

function defaultChartOptions(chartType: WidgetType): Record<string, unknown> {
  if (chartType === 'stat') {
    return { showLegend: false, showDataLabel: false };
  }
  if (chartType === 'pie' || chartType === 'donut') {
    return { showLegend: true, showDataLabel: false, innerRadius: chartType === 'donut' ? 40 : 0 };
  }
  return { showLegend: true, showDataLabel: false, showGridline: true, showAxis: true };
}

/** Build placeholder widgets positioned from layout presets (KPI row / executive grid). */
export function buildStarterDashboardWidgets(
  kind: StarterLayoutKind,
  activePageId?: string | null
): { widget: WidgetInstance; layoutItem: LayoutItem }[] {
  const presetId = kind === 'kpi' ? 'kpi-row' : 'executive';
  const preset = LAYOUT_PRESETS.find((p) => p.id === presetId);
  const specs = STARTER_WIDGETS[kind];
  if (!preset) return [];

  return specs.map((spec, idx) => {
    const slot = preset.layout[idx] ?? { x: 0, y: idx * 5, w: 6, h: 5 };
    const id = generateWidgetId();
    const widget: WidgetInstance = {
      id,
      chartType: spec.chartType,
      title: spec.title,
      chartOptions: defaultChartOptions(spec.chartType),
      chartQuery: spec.chartType === 'stat' ? { aggregate: 'count' as const } : undefined,
    };
    const layoutItem: LayoutItem = {
      i: id,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
      ...(activePageId ? { pageId: activePageId } : {}),
    };
    return { widget, layoutItem };
  });
}
