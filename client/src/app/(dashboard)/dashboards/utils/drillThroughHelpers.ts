import type { WidgetInstance } from '../stores/useDashboardStore';

export type DrillThroughConfig = {
  targetPageId: string;
  filterField?: string;
};

export function getDrillThrough(widget: WidgetInstance): DrillThroughConfig | null {
  const dt = widget.chartQuery?.drillThrough;
  if (!dt?.targetPageId) return null;
  return {
    targetPageId: String(dt.targetPageId),
    filterField: dt.filterField ? String(dt.filterField) : undefined,
  };
}

export function hasDrillThrough(widget: WidgetInstance): boolean {
  return Boolean(getDrillThrough(widget));
}
