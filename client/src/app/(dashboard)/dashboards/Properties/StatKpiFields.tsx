'use client';

import React from 'react';
import { TextInputField, SelectField, CheckboxField } from './FormFields';
import { useTranslations } from 'next-intl';

type Props = {
  chartOptions: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
};

/** KPI / stat monitoring fields for ops dashboards. */
export function StatKpiFields({ chartOptions, onUpdate }: Props) {
  const t = useTranslations('properties_panel');

  return (
    <div className="stat-kpi-fields">
      <TextInputField
        label={t('stat_unit')}
        value={String(chartOptions.statUnit ?? chartOptions.gaugeUnit ?? '')}
        onChange={(v) => onUpdate('statUnit', v)}
        placeholder="%, $, ms"
      />
      <TextInputField
        label={t('stat_compare_label')}
        value={String(chartOptions.compareLabel ?? '')}
        onChange={(v) => onUpdate('compareLabel', v)}
        placeholder={t('stat_compare_placeholder')}
      />
      <TextInputField
        label={t('threshold_warn')}
        value={chartOptions.thresholdWarn != null ? String(chartOptions.thresholdWarn) : ''}
        onChange={(v) => onUpdate('thresholdWarn', v === '' ? undefined : Number(v))}
      />
      <TextInputField
        label={t('threshold_critical')}
        value={chartOptions.thresholdCritical != null ? String(chartOptions.thresholdCritical) : ''}
        onChange={(v) => onUpdate('thresholdCritical', v === '' ? undefined : Number(v))}
      />
      <SelectField
        label={t('threshold_direction')}
        value={String(chartOptions.thresholdDirection ?? 'above')}
        onChange={(v) => onUpdate('thresholdDirection', v)}
        options={[
          { label: t('threshold_above'), value: 'above' },
          { label: t('threshold_below'), value: 'below' },
        ]}
      />
      <CheckboxField
        label={t('stat_show_sparkline')}
        checked={chartOptions.showSparkline !== false}
        onChange={(v) => onUpdate('showSparkline', v)}
      />
    </div>
  );
}

export default StatKpiFields;
