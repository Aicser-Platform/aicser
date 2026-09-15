import { WIDGET_TEMPLATES, buildWidgetSections as buildFromTemplates } from '../widgetTemplates';

export type WidgetSectionItem = (typeof WIDGET_TEMPLATES)[number];

export type WidgetSection = {
  title: string;
  items: WidgetSectionItem[];
};

/** @deprecated Prefer `buildWidgetSections` from `widgetTemplates`. */
export function buildWidgetSections(
  templates: WidgetSectionItem[] = WIDGET_TEMPLATES,
): WidgetSection[] {
  return buildFromTemplates(templates);
}
