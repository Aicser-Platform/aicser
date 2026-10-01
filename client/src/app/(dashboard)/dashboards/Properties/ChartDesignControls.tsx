'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { SelectField } from './FormFields';
import {
  applyChartDesignTemplate,
  CHART_DESIGN_TEMPLATES,
  type ChartDesign,
  type ChartDesignTemplate,
} from '../widgets/chartDesign';
import { getWidgetPropertyProfile } from './widgetPropertyProfile';

interface ChartDesignControlsProps {
  chartType: string;
  chartOptions: Record<string, any>;
  onUpdateChartOptions: (updates: Record<string, any>) => void;
}


/**
 * Format → Preset: a starting style for the chart type ("Ranked bar", "Efficiency scatter").
 * Shown only when the type has one besides Standard. Axis scales, data-label position and
 * reference lines live in their own Format sections (Axes, Labels, Analytics).
 */
export const ChartDesignControls: React.FC<ChartDesignControlsProps> = ({
  chartType,
  chartOptions,
  onUpdateChartOptions,
}) => {
  const t = useTranslations('chart_options');
  const profile = getWidgetPropertyProfile(chartType);
  if (!profile.showDesign) return null;

  const design: ChartDesign = chartOptions?.design || {};
  const template = (design.template || 'standard') as ChartDesignTemplate;
  const applicableTemplates = CHART_DESIGN_TEMPLATES.filter(
    (tpl) => tpl.id === 'standard' || tpl.chartTypes.includes(chartType),
  );
  if (applicableTemplates.length < 2) return null;

  const applyTemplate = (id: ChartDesignTemplate) => {
    const { design: nextDesign, chartOptionPatches } = applyChartDesignTemplate(id);
    onUpdateChartOptions({
      ...chartOptionPatches,
      // Keep what the preset doesn't set (reference lines, scales the person chose).
      design: { ...design, ...nextDesign },
    });
  };

  return (
    <div className="pp-format-section">
      <SelectField
        label={t('preset')}
        hint={t(
          (applicableTemplates.find((x) => x.id === template)?.descKey ||
            'design_template_standard_desc') as 'design_template_standard_desc',
        )}
        value={template}
        onChange={(v) => applyTemplate(v as ChartDesignTemplate)}
        options={applicableTemplates.map((tpl) => ({
          label: t(tpl.labelKey as 'design_template_standard'),
          value: tpl.id,
        }))}
        showSearch={false}
      />
    </div>
  );
};
