import shortid from 'shortid';
import type { LayoutItem } from '../stores/useDashboardStore';
import type { LayoutPreset } from '../components/LayoutPresetsMenu';
import type { WidgetInstance } from '../stores/dashboardStoreTypes';

export type LayoutSlotKind = 'kpi' | 'chart' | 'table' | 'header' | 'any';

const SLOT_LABELS: Record<LayoutSlotKind, string> = {
  kpi: 'KPI slot',
  chart: 'Chart slot',
  table: 'Table slot',
  header: 'Section',
  any: 'Widget slot',
};

const KPI_TYPES = new Set(['stat', 'gauge', 'kpi']);
const TABLE_TYPES = new Set(['table', 'pivot', 'heatmap']);
const HEADER_TYPES = new Set(['text', 'divider', 'image', 'filter', 'slicer']);
const CHART_TYPES = new Set([
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'scatter',
  'radar',
  'funnel',
  'waterfall',
  'combo',
  'boxplot',
  'treemap',
  'sunburst',
  'sankey',
  'geomap',
  'raw',
]);

/** Infer slot kind from preset position (executive / ops / rail patterns). */
export function inferSlotKind(
  presetId: string,
  index: number,
  slot: { w: number; h: number },
): LayoutSlotKind {
  if (presetId === 'kpi-row' || presetId === 'executive' || presetId === 'ops-center' || presetId === 'kpi-rail') {
    if (slot.h <= 3 && slot.w <= 4) return 'kpi';
  }
  if (presetId === 'kpi-rail' && slot.w <= 3) return 'kpi';
  if (presetId === 'report' && index === 0 && slot.h <= 2) return 'header';
  if (slot.h >= 5 && slot.w >= 8) return 'table';
  if (slot.h >= 5) return 'chart';
  if (slot.w <= 4 && slot.h <= 4) return 'kpi';
  return 'any';
}

/** Lower score = better fit for the slot. */
export function rankWidgetForSlot(widget: WidgetInstance, kind: LayoutSlotKind): number {
  const t = String(widget.chartType || '').toLowerCase();
  if (kind === 'kpi') return KPI_TYPES.has(t) ? 0 : HEADER_TYPES.has(t) ? 4 : 6;
  if (kind === 'table') return TABLE_TYPES.has(t) ? 0 : CHART_TYPES.has(t) ? 2 : 5;
  if (kind === 'chart') return CHART_TYPES.has(t) ? 0 : TABLE_TYPES.has(t) ? 2 : KPI_TYPES.has(t) ? 4 : 3;
  if (kind === 'header') return HEADER_TYPES.has(t) ? 0 : 5;
  if (KPI_TYPES.has(t)) return 1;
  if (CHART_TYPES.has(t)) return 1;
  return 2;
}

export function createLayoutSlotWidget(
  slot: { x: number; y: number; w: number; h: number },
  kind: LayoutSlotKind,
): { widget: WidgetInstance; layout: LayoutItem } {
  const id = shortid.generate();
  const label = SLOT_LABELS[kind];
  return {
    widget: {
      id,
      title: label,
      chartType: 'text',
      chartOptions: {
        _layoutSlot: true,
        slotKind: kind,
        body: `Drop a ${kind === 'kpi' ? 'KPI / stat' : kind === 'table' ? 'table' : 'chart'} here`,
      },
      chartQuery: {},
    } as WidgetInstance,
    layout: { i: id, x: slot.x, y: slot.y, w: slot.w, h: slot.h },
  };
}

function packOverflowItem(
  item: LayoutItem,
  startY: number,
  cols = 12,
): { placed: LayoutItem; nextY: number } {
  const w = Math.max(2, Math.min(cols, Number(item.w) || 6));
  const h = Math.max(2, Number(item.h) || 5);
  return {
    placed: { ...item, x: 0, y: startY, w, h },
    nextY: startY + h,
  };
}

/**
 * Apply preset: match widgets to slot kinds (KPIs→kpi slots, charts→chart…),
 * scaffold empty slots, and pack overflow below the preset instead of leaving
 * stranded coordinates.
 */
export function applyPresetWithScaffolds(
  preset: LayoutPreset,
  orderedLayout: LayoutItem[],
  existingWidgets: WidgetInstance[],
): {
  nextLayout: LayoutItem[];
  newWidgets: WidgetInstance[];
  newLayoutItems: LayoutItem[];
} {
  const widgetById = new Map(existingWidgets.map((w) => [w.id, w]));
  const realItems = orderedLayout.filter((item) => {
    const w = widgetById.get(item.i);
    return w && !isLayoutSlotWidget(w);
  });

  const slots = preset.layout.map((slot, idx) => ({
    ...slot,
    kind: inferSlotKind(preset.id, idx, slot),
  }));

  const remaining = [...realItems];
  const assigned: Array<LayoutItem | null> = slots.map(() => null);

  const takeBestForSlot = (slotIndex: number, maxScore: number) => {
    const slot = slots[slotIndex]!;
    let bestIdx = -1;
    let bestScore = maxScore + 0.1;
    for (let i = 0; i < remaining.length; i += 1) {
      const w = widgetById.get(remaining[i]!.i);
      if (!w) continue;
      const score = rankWidgetForSlot(w, slot.kind);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return;
    const chosen = remaining.splice(bestIdx, 1)[0]!;
    assigned[slotIndex] = {
      ...chosen,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
    };
  };

  // Pass 1: only strong fits so a chart is not consumed by an early KPI slot.
  for (let si = 0; si < slots.length; si += 1) {
    takeBestForSlot(si, 2);
  }

  // Pass 2: fill leftover slots with whatever remains (still prefer better scores).
  for (let si = 0; si < slots.length; si += 1) {
    if (assigned[si] || remaining.length === 0) continue;
    takeBestForSlot(si, 99);
  }

  const nextLayout: LayoutItem[] = assigned.filter(Boolean) as LayoutItem[];

  // Overflow widgets: stack below the preset footprint (keep sizes, full-width clamp).
  let overflowY = preset.layout.reduce((max, s) => Math.max(max, s.y + s.h), 0);
  for (const item of remaining) {
    const { placed, nextY } = packOverflowItem(item, overflowY);
    nextLayout.push(placed);
    overflowY = nextY;
  }

  const newWidgets: WidgetInstance[] = [];
  const newLayoutItems: LayoutItem[] = [];

  for (let idx = 0; idx < slots.length; idx += 1) {
    if (assigned[idx]) continue;
    const slot = slots[idx]!;
    const { widget, layout } = createLayoutSlotWidget(slot, slot.kind);
    newWidgets.push(widget);
    newLayoutItems.push(layout);
  }

  return {
    nextLayout,
    newWidgets,
    newLayoutItems,
  };
}

export function isLayoutSlotWidget(widget: WidgetInstance): boolean {
  return Boolean((widget.chartOptions as { _layoutSlot?: boolean })?._layoutSlot);
}
