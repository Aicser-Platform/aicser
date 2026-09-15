import type { LayoutItem, WidgetInstance } from '../stores/dashboardStoreTypes';
import { findWidgetTemplate, generateWidgetId } from './buildDashboardWidget';

export type StoryStarterId = 'headline' | 'trend' | 'compare' | 'narrative';

type StorySlot = {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  titleKey?: string;
};

/** Story-first scaffolds for an empty canvas (non-technical authors). */
export const STORY_STARTERS: Array<{
  id: StoryStarterId;
  titleKey: string;
  descKey: string;
  slots: StorySlot[];
}> = [
  {
    id: 'headline',
    titleKey: 'story_starter_headline',
    descKey: 'story_starter_headline_desc',
    slots: [
      { type: 'stat', x: 0, y: 0, w: 3, h: 3, titleKey: 'story_slot_kpi' },
      { type: 'stat', x: 3, y: 0, w: 3, h: 3, titleKey: 'story_slot_kpi' },
      { type: 'stat', x: 6, y: 0, w: 3, h: 3, titleKey: 'story_slot_kpi' },
      { type: 'stat', x: 9, y: 0, w: 3, h: 3, titleKey: 'story_slot_kpi' },
      { type: 'line', x: 0, y: 3, w: 12, h: 5, titleKey: 'story_slot_trend' },
    ],
  },
  {
    id: 'trend',
    titleKey: 'story_starter_trend',
    descKey: 'story_starter_trend_desc',
    slots: [{ type: 'line', x: 0, y: 0, w: 12, h: 6, titleKey: 'story_slot_trend' }],
  },
  {
    id: 'compare',
    titleKey: 'story_starter_compare',
    descKey: 'story_starter_compare_desc',
    slots: [
      { type: 'bar', x: 0, y: 0, w: 7, h: 5, titleKey: 'story_slot_compare' },
      { type: 'pie', x: 7, y: 0, w: 5, h: 5, titleKey: 'story_slot_share' },
    ],
  },
  {
    id: 'narrative',
    titleKey: 'story_starter_narrative',
    descKey: 'story_starter_narrative_desc',
    slots: [
      { type: 'text', x: 0, y: 0, w: 12, h: 2, titleKey: 'story_slot_narrative' },
      { type: 'stat', x: 0, y: 2, w: 4, h: 3, titleKey: 'story_slot_kpi' },
      { type: 'bar', x: 4, y: 2, w: 8, h: 5, titleKey: 'story_slot_compare' },
      { type: 'table', x: 0, y: 7, w: 12, h: 5, titleKey: 'story_slot_detail' },
    ],
  },
];

function defaultOptionsForType(type: string, title: string): Record<string, unknown> {
  switch (type) {
    case 'text':
      return {
        content: title,
        fontSize: 18,
        fontWeight: 600,
        color: 'inherit',
        textAlign: 'left',
      };
    case 'stat':
      return { format: 'number', fontSize: 32, layout: 'default', showSparkline: false };
    case 'pie':
    case 'donut':
      return { showLegend: true, showDataLabel: false, innerRadius: type === 'donut' ? 40 : 0 };
    case 'slicer':
    case 'filter':
      return { slicerLabel: title };
    default:
      return { showLegend: true, showDataLabel: false, showGridline: true, showAxis: true };
  }
}

function defaultQueryForType(type: string): WidgetInstance['chartQuery'] {
  if (type === 'text' || type === 'divider' || type === 'image' || type === 'embed') return {};
  if (type === 'stat') return { yMetric: 'count', yMetrics: [], sortBy: 'x' };
  if (type === 'slicer') return { mode: 'single' };
  if (type === 'filter') return { mode: 'multi' };
  return undefined;
}

export function buildStoryStarterLayout(
  starterId: StoryStarterId,
  tLabel: (key: string) => string,
): { widgets: WidgetInstance[]; layout: LayoutItem[] } | null {
  const starter = STORY_STARTERS.find((s) => s.id === starterId);
  if (!starter) return null;

  const widgets: WidgetInstance[] = [];
  const layout: LayoutItem[] = [];

  for (const slot of starter.slots) {
    const template = findWidgetTemplate(slot.type);
    if (!template) continue;
    const id = generateWidgetId();
    const title = slot.titleKey ? tLabel(slot.titleKey) : template.name;
    widgets.push({
      id,
      dataSourceId: undefined,
      chartType: slot.type as WidgetInstance['chartType'],
      title: slot.type === 'text' ? '' : title,
      chartOptions: defaultOptionsForType(slot.type, title),
      chartQuery: defaultQueryForType(slot.type),
    });
    layout.push({ i: id, x: slot.x, y: slot.y, w: slot.w, h: slot.h });
  }

  if (!widgets.length) return null;
  return { widgets, layout };
}
