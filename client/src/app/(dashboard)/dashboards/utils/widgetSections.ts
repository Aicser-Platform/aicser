import { WIDGET_TEMPLATES } from '../widgetTemplates';

export type WidgetSectionItem = (typeof WIDGET_TEMPLATES)[number];

export type WidgetSection = {
  title: string;
  items: WidgetSectionItem[];
};

/** Group shared widget templates by category for canvas empty state and pickers. */
export function buildWidgetSections(): WidgetSection[] {
  const byCategory = WIDGET_TEMPLATES.reduce<Record<string, WidgetSectionItem[]>>((acc, item) => {
    const cat = item.category || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  return Object.entries(byCategory).map(([title, items]) => ({ title, items }));
}
