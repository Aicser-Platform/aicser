import type { LayoutItem, WidgetInstance, WidgetType } from '../stores/useDashboardStore';
import { WIDGET_TEMPLATES } from '../widgetTemplates';
import { maxLayoutY } from './layoutSanitize';

export type WidgetTemplate = (typeof WIDGET_TEMPLATES)[number];

export function generateWidgetId(): string {
  return `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

export function findWidgetTemplate(type: string): WidgetTemplate | undefined {
  return WIDGET_TEMPLATES.find((t) => t.type === type);
}

export function buildWidgetFromTemplate(
  template: WidgetTemplate,
  activePageId?: string | null,
  existingLayout: LayoutItem[] = []
): { widget: WidgetInstance; layoutItem: LayoutItem } {
  const instanceId = generateWidgetId();
  const isPieChart = template.type === 'pie' || template.type === 'donut';
  const isTextWidget = template.type === 'text';
  const isStatWidget = template.type === 'stat';

  let defaultChartOptions: Record<string, unknown>;
  let defaultChartQuery: WidgetInstance['chartQuery'];

  if (isTextWidget) {
    defaultChartOptions = {
      content: '',
      fontSize: 14,
      fontWeight: 400,
      color: 'inherit',
      textAlign: 'left',
    };
    defaultChartQuery = {};
  } else if (isStatWidget) {
    defaultChartOptions = {
      format: 'number',
      fontSize: 32,
      layout: 'compact',
      showSparkline: false,
    };
    defaultChartQuery = { yMetric: 'count', yMetrics: [], sortBy: 'x' };
  } else if (isPieChart) {
    defaultChartOptions = {
      showLegend: true,
      showDataLabel: false,
      innerRadius: template.type === 'donut' ? 40 : 0,
    };
  } else {
    defaultChartOptions = {
      showLegend: true,
      showDataLabel: false,
      showGridline: true,
      showAxis: true,
    };
  }

  const widget: WidgetInstance = {
    id: instanceId,
    dataSourceId: undefined,
    chartQuery: defaultChartQuery,
    chartType: template.type as WidgetType,
    title: isTextWidget ? '' : template.name.trim(),
    chartOptions: defaultChartOptions,
  };

  const layoutItem: LayoutItem = {
    i: instanceId,
    x: 0,
    y: maxLayoutY(existingLayout),
    w: template.defaultSize.w,
    h: template.defaultSize.h,
    ...(activePageId ? { pageId: activePageId } : {}),
  };

  return { widget, layoutItem };
}
