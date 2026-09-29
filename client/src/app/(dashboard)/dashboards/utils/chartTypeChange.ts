import type { WidgetInstance } from '../stores/useDashboardStore';
import { normalizeChartOptionsOnTypeChange, preserveChartQueryOnTypeChange } from './chartTypeMappingPreserve';
import { autoTitlePatch } from './widgetAutoTitle';

type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * Everything a chart-type switch changes, in one place, for every entry point (Properties, the
 * card's quick bar): mappings that fit the new type are kept, options the new type can't use are
 * dropped, and an automatic title follows the new type.
 */
export function chartTypeChangePatch(
  widget: WidgetInstance,
  nextType: string,
  t: Translate,
  placeholderTitles: Iterable<string> = [],
): Partial<WidgetInstance> {
  const chartQuery = preserveChartQueryOnTypeChange(widget, nextType);
  const chartOptions = normalizeChartOptionsOnTypeChange(nextType, (widget.chartOptions || {}) as Record<string, unknown>);
  const next = { ...widget, chartType: nextType, chartQuery, chartOptions } as WidgetInstance;
  const retitle = autoTitlePatch(widget as never, next as never, t, placeholderTitles);
  return {
    chartType: nextType as WidgetInstance['chartType'],
    chartQuery: chartQuery as WidgetInstance['chartQuery'],
    chartOptions: (retitle?.chartOptions ?? chartOptions) as WidgetInstance['chartOptions'],
    ...(retitle ? { title: retitle.title } : {}),
  };
}
