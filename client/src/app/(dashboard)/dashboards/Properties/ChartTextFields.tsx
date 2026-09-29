'use client';

import React from 'react';
import { Checkbox, ColorPicker, InputNumber, Segmented, Select } from 'antd';
import { useTranslations } from 'next-intl';
import { PpLabel } from './PpLabel';
import { AdvancedCollapse } from './AdvancedCollapse';
import { TEXT_FONTS } from '../widgets/textStyles';
import { getWidgetPropertyProfile } from './widgetPropertyProfile';

type Row = {
  key: string;
  label: string;
  colorKey: string;
  sizeKey: string;
  boldKey?: string;
  /** Default size shown as the placeholder (px). */
  size: number;
};

/**
 * Format → Text: one font, size and color for all of the chart's text (the quick path), and
 * per-element color / size / bold for title, axis labels, data labels and legend, folded.
 */
export function ChartTextFields({
  chartType,
  chartOptions,
  isDesigner,
  onUpdateChartOptions,
}: {
  chartType: string;
  chartOptions: Record<string, any>;
  isDesigner?: boolean;
  onUpdateChartOptions: (updates: Record<string, any>) => void;
}) {
  const t = useTranslations('chart_options');
  const profile = getWidgetPropertyProfile(chartType);
  if (profile.kind === 'content' || profile.kind === 'control') return null;

  const set = (key: string, value: unknown) => onUpdateChartOptions({ [key]: value === '' || value === null ? undefined : value });
  const rows: Row[] = [
    // The Designer shows the title in its toolbar, not on a card.
    ...(!isDesigner
      ? [{ key: 'title', label: t('text_title'), colorKey: 'titleColor', sizeKey: 'titleSize', boldKey: 'titleBold', size: 14 }]
      : []),
    ...(profile.showCartesianAxes
      ? [{ key: 'axis', label: t('text_axis'), colorKey: 'axisTextColor', sizeKey: 'axisTextSize', size: 11 }]
      : []),
    ...(profile.showDataLabelToggle
      ? [{ key: 'labels', label: t('text_data_labels'), colorKey: 'dataLabelColor', sizeKey: 'dataLabelSize', boldKey: 'dataLabelBold', size: 11 }]
      : []),
    ...(profile.showLegendToggle
      ? [{ key: 'legend', label: t('text_legend'), colorKey: 'legendTextColor', sizeKey: 'legendTextSize', size: 12 }]
      : []),
  ];
  const perElementUsed = rows.some(
    (r) => chartOptions[r.colorKey] || chartOptions[r.sizeKey] || (r.boldKey && chartOptions[r.boldKey] !== undefined),
  );

  return (
    <div className="pp-format-section">
      <PpLabel>{t('text')}</PpLabel>
      <div className="pp-format-stack">
        <div className="pp-text-row">
          <Select
            size="small"
            value={chartOptions.textFont || 'default'}
            aria-label={t('text_font')}
            onChange={(v) => set('textFont', v === 'default' ? undefined : v)}
            options={Object.entries(TEXT_FONTS).map(([id, family]) => ({
              value: id,
              label: <span style={{ fontFamily: family || undefined }}>{t(`text_font_${id}`)}</span>,
            }))}
          />
          <ColorPicker
            size="small"
            allowClear
            value={chartOptions.textColor || null}
            onChangeComplete={(c) => set('textColor', c.cleared ? undefined : c.toHexString())}
            onClear={() => set('textColor', undefined)}
          />
        </div>
        <Segmented
          size="small"
          block
          value={chartOptions.textSize || 'medium'}
          options={[
            { label: t('text_size_small'), value: 'small' },
            { label: t('text_size_medium'), value: 'medium' },
            { label: t('text_size_large'), value: 'large' },
          ]}
          onChange={(v) => set('textSize', v === 'medium' ? undefined : v)}
        />
        {rows.length ? (
          <AdvancedCollapse title={t('text_per_element')} active={perElementUsed}>
            <div className="pp-text-elements">
              {rows.map((r) => (
                <div key={r.key} className="pp-text-element">
                  <span className="pp-text-element-name">{r.label}</span>
                  <ColorPicker
                    size="small"
                    allowClear
                    value={chartOptions[r.colorKey] || null}
                    onChangeComplete={(c) => set(r.colorKey, c.cleared ? undefined : c.toHexString())}
                    onClear={() => set(r.colorKey, undefined)}
                  />
                  <InputNumber
                    size="small"
                    min={8}
                    max={40}
                    placeholder={String(r.size)}
                    value={typeof chartOptions[r.sizeKey] === 'number' ? chartOptions[r.sizeKey] : null}
                    aria-label={`${r.label} ${t('text_size')}`}
                    onChange={(v) => set(r.sizeKey, v === null ? undefined : Number(v))}
                  />
                  {r.boldKey ? (
                    <Checkbox
                      checked={r.key === 'title' ? chartOptions.titleBold !== false : chartOptions[r.boldKey] === true}
                      onChange={(e) =>
                        set(r.boldKey!, r.key === 'title' ? (e.target.checked ? undefined : false) : e.target.checked || undefined)
                      }
                    >
                      {t('text_bold')}
                    </Checkbox>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
          </AdvancedCollapse>
        ) : null}
      </div>
    </div>
  );
}
