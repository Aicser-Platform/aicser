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

/** Infer slot kind from preset position (executive / ops patterns). */
export function inferSlotKind(presetId: string, index: number, slot: { w: number; h: number }): LayoutSlotKind {
  if (presetId === 'kpi-row' || presetId === 'executive' || presetId === 'ops-center') {
    if (slot.h <= 3 && slot.w <= 4) return 'kpi';
  }
  if (presetId === 'report' && index === 0 && slot.h <= 2) return 'header';
  if (slot.h >= 5 && slot.w >= 8) return 'table';
  if (slot.h >= 5) return 'chart';
  if (slot.w <= 4 && slot.h <= 4) return 'kpi';
  return 'any';
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

/**
 * Apply preset: reposition existing widgets, then add placeholder slots for empty positions.
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
  const nextLayout = orderedLayout.map((item, idx) => {
    const slot = preset.layout[idx];
    if (!slot) return item;
    return { ...item, x: slot.x, y: slot.y, w: slot.w, h: slot.h };
  });

  const newWidgets: WidgetInstance[] = [];
  const newLayoutItems: LayoutItem[] = [];

  for (let idx = orderedLayout.length; idx < preset.layout.length; idx++) {
    const slot = preset.layout[idx];
    const kind = inferSlotKind(preset.id, idx, slot);
    const { widget, layout } = createLayoutSlotWidget(slot, kind);
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
