import type { WidgetInstance } from '../../stores/useDashboardStore';
import type { DashboardExecutiveMeta, WidgetInsightItem } from '../../components/viewer/DashboardExecutiveBanner';

export function executiveMetaFromConfig(
  config?: Record<string, unknown> | null,
): Pick<DashboardExecutiveMeta, 'keyInsight' | 'storyArc'> {
  if (!config || typeof config !== 'object') {
    return {};
  }
  const keyInsight = typeof config.key_insight === 'string' ? config.key_insight.trim() : '';
  const storyArc = typeof config.story_arc === 'string' ? config.story_arc.trim() : '';
  return {
    keyInsight: keyInsight || undefined,
    storyArc: storyArc || undefined,
  };
}

export function widgetInsightsFromWidgets(widgets: WidgetInstance[]): WidgetInsightItem[] {
  return widgets
    .filter((w) => w.chartType !== 'text' && w.chartType !== 'slicer')
    .map((w) => {
      const subtitle =
        typeof w.chartOptions?.subtitle === 'string' ? w.chartOptions.subtitle.trim() : '';
      return {
        id: w.id,
        title: w.title?.trim() || 'Widget',
        insight: subtitle || undefined,
      };
    })
    .filter((w) => w.insight);
}

export function buildDashboardViewerMeta(
  base: { id: string; title: string; description?: string },
  config?: Record<string, unknown> | null,
  widgets: WidgetInstance[] = [],
): DashboardExecutiveMeta & { id: string; title: string; description?: string } {
  const exec = executiveMetaFromConfig(config);
  return {
    ...base,
    ...exec,
    widgetInsights: widgetInsightsFromWidgets(widgets),
  };
}
