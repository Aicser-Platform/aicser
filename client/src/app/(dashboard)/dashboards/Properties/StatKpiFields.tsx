'use client';

import React from 'react';
import { TextInputField, SelectField, CheckboxField } from './FormFields';
import { PpLabel } from './PpLabel';
import { useTranslations } from 'next-intl';
import { IconPicker } from '../icons';

type Props = {
  chartOptions: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
};

/** KPI / stat monitoring fields for ops dashboards. */
export function StatKpiFields({ chartOptions, onUpdate }: Props) {
  const t = useTranslations('properties_panel');
  const td = useTranslations('dashboards');

  return (
    <div className="stat-kpi-fields">
      <div>
        <PpLabel>{td('icon_label')}</PpLabel>
        <IconPicker
          value={chartOptions.icon}
          legacyIconName={chartOptions.iconName}
          onChange={(icon) => {
            onUpdate('icon', icon || undefined);
            if (!icon) onUpdate('iconName', undefined);
            else if (icon.set === 'antd') onUpdate('iconName', icon.name);
          }}
          onClearLegacy={() => onUpdate('iconName', undefined)}
        />
      </div>
      <TextInputField
        label={t('stat_currency_symbol')}
        hint={t('stat_currency_hint')}
        value={String(chartOptions.currencySymbol ?? (chartOptions.format === 'currency' ? '$' : ''))}
        onChange={(v) => onUpdate('currencySymbol', v || undefined)}
        placeholder={t('stat_currency_placeholder')}
      />
      <TextInputField
        label={t('stat_unit')}
        hint={t('stat_unit_hint')}
        value={String(chartOptions.statUnit ?? chartOptions.gaugeUnit ?? '')}
        onChange={(v) => onUpdate('statUnit', v)}
        placeholder={t('stat_unit_placeholder')}
      />
      <TextInputField
        label={t('stat_goal')}
        hint={t('stat_goal_hint')}
        value={chartOptions.goalTarget != null ? String(chartOptions.goalTarget) : ''}
        onChange={(v) => onUpdate('goalTarget', v === '' ? undefined : Number(v))}
        placeholder={t('stat_goal_placeholder')}
      />
      <TextInputField
        label={t('stat_compare_label')}
        hint={t('stat_compare_hint')}
        value={String(chartOptions.comparisonPeriodLabel ?? chartOptions.compareLabel ?? '')}
        onChange={(v) => {
          onUpdate('comparisonPeriodLabel', v);
          onUpdate('compareLabel', v);
        }}
        placeholder={t('stat_compare_placeholder')}
      />
      <TextInputField
        label={t('threshold_warn')}
        hint={t('threshold_warn_hint')}
        value={chartOptions.thresholdWarn != null ? String(chartOptions.thresholdWarn) : ''}
        onChange={(v) => onUpdate('thresholdWarn', v === '' ? undefined : Number(v))}
      />
      <TextInputField
        label={t('threshold_critical')}
        hint={t('threshold_critical_hint')}
        value={chartOptions.thresholdCritical != null ? String(chartOptions.thresholdCritical) : ''}
        onChange={(v) => onUpdate('thresholdCritical', v === '' ? undefined : Number(v))}
      />
      <SelectField
        label={t('threshold_direction')}
        hint={t('threshold_direction_hint')}
        value={String(chartOptions.thresholdDirection ?? 'above')}
        onChange={(v) => onUpdate('thresholdDirection', v)}
        options={[
          { label: t('threshold_above'), value: 'above' },
          { label: t('threshold_below'), value: 'below' },
        ]}
      />
      <SelectField
        label={t('stat_layout')}
        hint={t('stat_layout_hint')}
        value={String(chartOptions.layout ?? 'default')}
        onChange={(v) => onUpdate('layout', v)}
        options={[
          { label: t('stat_layout_default'), value: 'default' },
          { label: t('stat_layout_compact'), value: 'compact' },
          { label: t('stat_layout_centered'), value: 'centered' },
          { label: t('stat_layout_split'), value: 'split' },
          { label: t('stat_layout_tile'), value: 'tile' },
          { label: t('stat_layout_executive'), value: 'executive' },
        ]}
      />
      <CheckboxField
        label={t('stat_show_sparkline')}
        checked={chartOptions.showSparkline === true}
        onChange={(v) => onUpdate('showSparkline', v)}
      />
    </div>
  );
}

export default StatKpiFields;
