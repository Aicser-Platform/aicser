import type { WidgetInstance } from '../stores/useDashboardStore';

export type WidgetDrillFilter = { field: string; value: unknown };

export type WidgetDrillState = {
  level: number;
  filters: WidgetDrillFilter[];
};

export type DrillContextPayload = {
  level: number;
  drill_path: string[];
  drill_filters: Array<{ field: string; operator: string; value: unknown }>;
};

export function getDrillPath(widget: WidgetInstance): string[] {
  const path = widget.chartQuery?.drillPath;
  return Array.isArray(path) ? path.filter(Boolean) : [];
}

export function hasDrillPath(widget: WidgetInstance): boolean {
  return getDrillPath(widget).length > 0;
}

export function getInteractionMode(widget: WidgetInstance): 'drill' | 'cross_filter' {
  const mode = widget.chartQuery?.interactionMode;
  if (mode === 'cross_filter') return 'cross_filter';
  if (hasDrillPath(widget)) return 'drill';
  return 'cross_filter';
}

export function buildDrillContext(
  widget: WidgetInstance,
  drillState?: WidgetDrillState | null,
): DrillContextPayload | undefined {
  const drillPath = getDrillPath(widget);
  if (!drillPath.length || !drillState) return undefined;
  return {
    level: drillState.level,
    drill_path: drillPath,
    drill_filters: drillState.filters.map((f) => ({
      field: f.field,
      operator: '=',
      value: f.value,
    })),
  };
}

export function getEffectiveDrillX(widget: WidgetInstance, drillState?: WidgetDrillState | null): string | undefined {
  const drillPath = getDrillPath(widget);
  if (!drillPath.length) return widget.chartQuery?.x;
  const level = drillState?.level ?? 0;
  const idx = Math.min(Math.max(level, 0), drillPath.length - 1);
  return drillPath[idx] || widget.chartQuery?.x;
}

export function canDrillDeeper(widget: WidgetInstance, drillState: WidgetDrillState): boolean {
  const drillPath = getDrillPath(widget);
  return drillState.level < drillPath.length - 1;
}

export function createNextDrillState(
  widget: WidgetInstance,
  current: WidgetDrillState | undefined,
  field: string,
  value: unknown,
): WidgetDrillState | null {
  const drillPath = getDrillPath(widget);
  if (!drillPath.length) return null;

  const level = current?.level ?? 0;
  const expectedField = drillPath[level];
  if (field !== expectedField) return null;

  const filters = [...(current?.filters ?? []), { field, value }];
  if (level >= drillPath.length - 1) {
    return { level, filters };
  }
  return { level: level + 1, filters };
}

export function drillStateAtLevel(drillState: WidgetDrillState, toLevel: number): WidgetDrillState {
  const drillPathLength = drillState.filters.length;
  const safeLevel = Math.max(0, Math.min(toLevel, drillPathLength));
  return {
    level: safeLevel,
    filters: drillState.filters.slice(0, safeLevel),
  };
}

export function encodeDrillStateParam(states: Record<string, WidgetDrillState>): string {
  const compact = Object.entries(states).map(([widgetId, state]) => ({
    w: widgetId,
    l: state.level,
    f: state.filters.map((x) => [x.field, x.value]),
  }));
  if (!compact.length) return '';
  try {
    return btoa(JSON.stringify(compact));
  } catch {
    return '';
  }
}

export function decodeDrillStateParam(raw: string | null): Record<string, WidgetDrillState> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(atob(raw)) as Array<{ w: string; l: number; f: [string, unknown][] }>;
    const out: Record<string, WidgetDrillState> = {};
    parsed.forEach((entry) => {
      if (!entry?.w) return;
      out[entry.w] = {
        level: entry.l ?? 0,
        filters: (entry.f || []).map(([field, value]) => ({ field, value })),
      };
    });
    return out;
  } catch {
    return {};
  }
}
