'use client';

import React from 'react';
import { Button, InputNumber, Space } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { CheckboxField, InputField, SelectField } from './FormFields';
import { PpLabel } from './PpLabel';
import {
  applyChartDesignTemplate,
  CHART_DESIGN_TEMPLATES,
  type ChartDesign,
  type ChartDesignMarkLine,
  type ChartDesignTemplate,
} from '../widgets/chartDesign';
import { getWidgetPropertyProfile } from './widgetPropertyProfile';

interface ChartDesignControlsProps {
  chartType: string;
  chartOptions: Record<string, any>;
  onUpdateChartOptions: (updates: Record<string, any>) => void;
}

function mergeDesign(
  current: ChartDesign | undefined,
  patch: Partial<ChartDesign>,
): ChartDesign {
  return {
    ...(current || {}),
    ...patch,
    axis: { ...(current?.axis || {}), ...(patch.axis || {}) },
    labels: { ...(current?.labels || {}), ...(patch.labels || {}) },
    marks: {
      ...(current?.marks || {}),
      ...(patch.marks || {}),
      areas: patch.marks?.areas ?? current?.marks?.areas,
      lines: patch.marks?.lines ?? current?.marks?.lines,
      callouts: patch.marks?.callouts ?? current?.marks?.callouts,
    },
    brand: { ...(current?.brand || {}), ...(patch.brand || {}) },
  };
}

/**
 * Format → Design: templates, log axes, thresholds, ranked labels.
 * Aligns with Tableau Marks / Power BI format / Looker vis config —
 * presentation stays in chartOptions.design, not chartQuery.
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

  const setDesign = (patch: Partial<ChartDesign>, extraOptions?: Record<string, unknown>) => {
    onUpdateChartOptions({
      ...(extraOptions || {}),
      design: mergeDesign(design, patch),
    });
  };

  const applyTemplate = (id: ChartDesignTemplate) => {
    const { design: nextDesign, chartOptionPatches } = applyChartDesignTemplate(id);
    onUpdateChartOptions({
      ...chartOptionPatches,
      design: nextDesign,
    });
  };

  const lines: ChartDesignMarkLine[] = design.marks?.lines || [];

  const updateLine = (index: number, patch: Partial<ChartDesignMarkLine>) => {
    const next = lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
    setDesign({ marks: { ...design.marks, lines: next } });
  };

  const addLine = () => {
    setDesign({
      marks: {
        ...design.marks,
        lines: [...lines, { axis: 'y', value: 0, label: '' }],
      },
    });
  };

  const removeLine = (index: number) => {
    setDesign({
      marks: {
        ...design.marks,
        lines: lines.filter((_, i) => i !== index),
      },
    });
  };

  return (
    <div className="pp-format-section">
      <PpLabel>{t('design')}</PpLabel>
      <p className="pp-hint" style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
        {t('design_tip')}
      </p>
      <div className="pp-options-grid">
        <SelectField
          label={t('design_template')}
          value={template}
          onChange={(v) => applyTemplate(v as ChartDesignTemplate)}
          options={applicableTemplates.map((tpl) => ({
            label: t(tpl.labelKey as 'design_template_standard'),
            value: tpl.id,
          }))}
          showSearch={false}
        />
        <p style={{ margin: '-4px 0 4px', fontSize: 11, color: 'var(--ant-color-text-quaternary)', gridColumn: '1 / -1' }}>
          {t(
            (applicableTemplates.find((x) => x.id === template)?.descKey ||
              'design_template_standard_desc') as 'design_template_standard_desc',
          )}
        </p>

        {profile.showCartesianAxes ? (
          <>
            <SelectField
              label={t('design_x_scale')}
              value={design.axis?.xScale || 'linear'}
              onChange={(v) => setDesign({ axis: { xScale: v as 'linear' | 'log' } })}
              options={[
                { label: t('design_scale_linear'), value: 'linear' },
                { label: t('design_scale_log'), value: 'log' },
              ]}
              showSearch={false}
            />
            <SelectField
              label={t('design_y_scale')}
              value={design.axis?.yScale || 'linear'}
              onChange={(v) => setDesign({ axis: { yScale: v as 'linear' | 'log' } })}
              options={[
                { label: t('design_scale_linear'), value: 'linear' },
                { label: t('design_scale_log'), value: 'log' },
              ]}
              showSearch={false}
            />
          </>
        ) : null}

        {chartType === 'bar' || chartType === 'horizontal_bar' ? (
          <CheckboxField
            label={t('design_value_on_bar')}
            checked={!!design.labels?.valueOnBar}
            onChange={(checked) =>
              setDesign(
                { labels: { valueOnBar: checked, valuePosition: design.labels?.valuePosition || 'inside' } },
                checked ? { showDataLabel: true } : undefined,
              )
            }
          />
        ) : null}

        {chartType === 'scatter' ? (
          <CheckboxField
            label={t('design_pareto')}
            checked={!!design.marks?.pareto}
            onChange={(checked) => setDesign({ marks: { ...design.marks, pareto: checked } })}
          />
        ) : null}

        <InputField
          label={t('design_brand_footer')}
          value={design.brand?.footer ?? ''}
          placeholder={t('design_brand_footer_placeholder')}
          onChange={(v) => setDesign({ brand: { footer: v || undefined } })}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t('design_thresholds')}</span>
          <Button type="link" size="small" icon={<PlusOutlined />} onClick={addLine}>
            {t('design_add_threshold')}
          </Button>
        </div>
        {lines.length === 0 ? (
          <p style={{ margin: 0, fontSize: 11, color: 'var(--ant-color-text-quaternary)' }}>
            {t('design_thresholds_empty')}
          </p>
        ) : (
          lines.map((line, idx) => (
            <Space key={idx} align="start" style={{ display: 'flex', marginBottom: 8 }} wrap>
              <SelectField
                label={t('design_threshold_axis')}
                value={line.axis || 'y'}
                onChange={(v) => updateLine(idx, { axis: v as 'x' | 'y' })}
                options={[
                  { label: 'Y', value: 'y' },
                  { label: 'X', value: 'x' },
                ]}
                showSearch={false}
              />
              <div>
                <div style={{ fontSize: 11, marginBottom: 4 }}>{t('design_threshold_value')}</div>
                <InputNumber
                  size="small"
                  value={line.value}
                  onChange={(v) => updateLine(idx, { value: Number(v) || 0 })}
                  style={{ width: 100 }}
                />
              </div>
              <InputField
                label={t('design_threshold_label')}
                value={line.label ?? ''}
                onChange={(v) => updateLine(idx, { label: v || undefined })}
              />
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => removeLine(idx)}
                aria-label={t('design_remove_threshold')}
                style={{ marginTop: 22 }}
              />
            </Space>
          ))
        )}
      </div>
    </div>
  );
};
