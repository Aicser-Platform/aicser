import type { WidgetTemplate } from '../widgetTemplates';

const TYPE_KEYS: Record<string, { name: string; desc: string; bestFor?: string }> = {
  line: { name: 'type_line', desc: 'desc_line', bestFor: 'best_for_line' },
  bar: { name: 'type_bar', desc: 'desc_bar', bestFor: 'best_for_bar' },
  area: { name: 'type_area', desc: 'desc_area', bestFor: 'best_for_area' },
  donut: { name: 'type_donut', desc: 'desc_donut', bestFor: 'best_for_donut' },
  pie: { name: 'type_pie', desc: 'desc_pie', bestFor: 'best_for_pie' },
  scatter: { name: 'type_scatter', desc: 'desc_scatter', bestFor: 'best_for_scatter' },
  heatmap: { name: 'type_heatmap', desc: 'desc_heatmap', bestFor: 'best_for_heatmap' },
  funnel: { name: 'type_funnel', desc: 'desc_funnel', bestFor: 'best_for_funnel' },
  table: { name: 'type_table', desc: 'desc_table', bestFor: 'best_for_table' },
  text: { name: 'type_text', desc: 'desc_text', bestFor: 'best_for_text' },
  stat: { name: 'type_stat', desc: 'desc_stat', bestFor: 'best_for_stat' },
  slicer: { name: 'type_slicer', desc: 'desc_slicer', bestFor: 'best_for_slicer' },
  filter: { name: 'type_filter', desc: 'desc_filter', bestFor: 'best_for_filter' },
  gauge: { name: 'type_gauge', desc: 'desc_gauge', bestFor: 'best_for_gauge' },
  treemap: { name: 'type_treemap', desc: 'desc_treemap', bestFor: 'best_for_treemap' },
  waterfall: { name: 'type_waterfall', desc: 'desc_waterfall', bestFor: 'best_for_waterfall' },
  bullet: { name: 'type_bullet', desc: 'desc_bullet', bestFor: 'best_for_bullet' },
  divider: { name: 'type_divider', desc: 'desc_divider', bestFor: 'best_for_divider' },
  image: { name: 'type_image', desc: 'desc_image', bestFor: 'best_for_image' },
  geo: { name: 'type_geo', desc: 'desc_geo', bestFor: 'best_for_geo' },
  embed: { name: 'type_embed', desc: 'desc_embed', bestFor: 'best_for_embed' },
};

/** Localize widget template using chart_designer (or dashboards_page) i18n namespace. */
export function localizeWidgetTemplate(
  item: WidgetTemplate,
  t: (key: string) => string,
): WidgetTemplate & { bestFor?: string } {
  const keys = TYPE_KEYS[item.type];
  if (!keys) return item;

  const safe = (key: string, fallback: string) => {
    try {
      const value = t(key);
      return value && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  };

  const bestFor = keys.bestFor ? safe(keys.bestFor, '') : undefined;

  return {
    ...item,
    name: safe(keys.name, item.name),
    description: safe(keys.desc, item.description),
    bestFor: bestFor || undefined,
  };
}

export const FEATURED_WIDGET_TYPES = [
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'stat',
  'table',
  'text',
  'slicer',
] as const;
