'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { WIDGET_TEMPLATES, type WidgetTemplate } from '@/app/(dashboard)/dashboards/widgetTemplates';

const CATEGORY_KEYS: Record<string, 'category_visuals' | 'category_indicators' | 'category_data' | 'category_content'> = {
  Visuals: 'category_visuals',
  Indicators: 'category_indicators',
  Data: 'category_data',
  Content: 'category_content',
};

/** Widget templates with localized name, description, and category. */
export function useLocalizedWidgetTemplates(templates: WidgetTemplate[] = WIDGET_TEMPLATES): WidgetTemplate[] {
  const t = useTranslations('chart_designer');

  return useMemo(
    () =>
      templates.map((item) => {
        const slug = item.type.replace(/-/g, '_');
        const typeKey = `type_${slug}` as Parameters<typeof t>[0];
        const descKey = `desc_${slug}` as Parameters<typeof t>[0];
        const categoryKey = CATEGORY_KEYS[item.category] ?? 'category_visuals';

        return {
          ...item,
          name: t(typeKey),
          description: t(descKey),
          category: t(categoryKey),
        };
      }),
    [templates, t],
  );
}
