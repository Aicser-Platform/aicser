'use client';

import React from 'react';
import { Collapse } from 'antd';
import { TextInputField, SelectField, CheckboxField } from './FormFields';
import { PpLabel } from './PpLabel';
import { useTranslations } from 'next-intl';
import { IconPicker } from '../icons';
import { ConditionalFormattingEditor } from './ConditionalFormattingEditor';
import type { ConditionalFormattingRule } from './ConditionalFormattingEditor';
import { CurrencySymbolField } from './CurrencySymbolField';
import { COMPARISON_PERIOD_LABELS } from '../utils/timeIntelligence';

type Props = {
  chartOptions: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
};

const COMPARISON_LABELS: Record<string, string> = {
  wow: COMPARISON_PERIOD_LABELS.wow,
  mom: COMPARISON_PERIOD_LABELS.mom,
  qoq: COMPARISON_PERIOD_LABELS.qoq,
  yoy: COMPARISON_PERIOD_LABELS.yoy,
  none: '',
};

/** Every KPI Format field, in four groups: Number, Look, Trend, then Targets & alerts (folded).
 * A field shows only where it does something (currency symbol for Currency, unit for Number,
 * sparkline type once the sparkline is on). */
export function StatKpiFields({ chartOptions, onUpdate }: Props) {
  const t = useTranslations('properties_panel');
  const td = useTranslations('dashboards');
  const tc = useTranslations('chart_specific_fields');
  const format = String(chartOptions.format || 'number');
  const showTrend = chartOptions.showTrend !== false;

  const setComparisonPeriod = (v: string) => {
    onUpdate('comparisonPeriod', v === 'none' ? undefined : v);
    // Replace the compare label only while it is still an automatic one, never a typed one.
    const prevLabel = String(chartOptions.comparisonPeriodLabel || '');
    const legacyPrefixed = Object.values(COMPARISON_PERIOD_LABELS).map((l) => `vs ${l}`);
    const prevAuto = prevLabel === '' || Object.values(COMPARISON_LABELS).includes(prevLabel) || legacyPrefixed.includes(prevLabel);
    if (prevAuto) onUpdate('comparisonPeriodLabel', COMPARISON_LABELS[v] || '');
  };

  // Targets & alerts fold away until used, so a first KPI shows the few things people change.
  const hasTargets = [
    chartOptions.goalTarget,
    chartOptions.thresholdWarn,
    chartOptions.thresholdCritical,
  ].some((v) => v != null && v !== '') || ((chartOptions.conditionalFormatting as unknown[]) ?? []).length > 0;

  return (
    <div className="stat-kpi-fields">
      <PpLabel>{t('kpi_section_number')}</PpLabel>
      <SelectField
        label={tc('stat_format')}
        value={format}
        onChange={(v) => onUpdate('format', v)}
        options={[
          { label: tc('stat_format_number'), value: 'number' },
          { label: tc('stat_format_currency'), value: 'currency' },
          { label: tc('stat_format_percent'), value: 'percent' },
        ]}
        showSearch={false}
      />
      {format === 'currency' ? (
        <CurrencySymbolField
          label={t('stat_currency_symbol')}
          hint={t('stat_currency_hint')}
          value={String(chartOptions.currencySymbol ?? '$')}
          onChange={(v) => onUpdate('currencySymbol', v || undefined)}
        />
      ) : null}
      {format === 'number' ? (
        <TextInputField
          label={t('stat_unit')}
          hint={t('stat_unit_hint')}
          value={String(chartOptions.statUnit ?? chartOptions.gaugeUnit ?? '')}
          onChange={(v) => onUpdate('statUnit', v)}
          placeholder={t('stat_unit_placeholder')}
        />
      ) : null}

      <PpLabel>{t('kpi_section_look')}</PpLabel>
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
        showSearch={false}
      />
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
      <CheckboxField
        label={t('stat_show_sparkline')}
        checked={chartOptions.showSparkline === true}
        onChange={(v) => onUpdate('showSparkline', v)}
      />
      {chartOptions.showSparkline === true ? (
        <SelectField
          label={tc('stat_sparkline_type')}
          value={String(chartOptions.sparklineType || 'line')}
          onChange={(v) => onUpdate('sparklineType', v)}
          options={[
            { label: tc('stat_sparkline_line'), value: 'line' },
            { label: tc('stat_sparkline_bar'), value: 'bar' },
          ]}
          showSearch={false}
        />
      ) : null}

      <PpLabel>{t('kpi_section_trend')}</PpLabel>
      <CheckboxField
        label={tc('stat_show_trend')}
        checked={showTrend}
        onChange={(v) => onUpdate('showTrend', v)}
      />
      {showTrend ? (
        <>
          <SelectField
            label={tc('stat_comparison_period')}
            hint={tc('stat_comparison_period_hint')}
            value={String(chartOptions.comparisonPeriod || 'none')}
            onChange={(v) => setComparisonPeriod(String(v))}
            options={[
              { label: tc('stat_comparison_none'), value: 'none' },
              { label: tc('stat_comparison_wow'), value: 'wow' },
              { label: tc('stat_comparison_mom'), value: 'mom' },
              { label: tc('stat_comparison_qoq'), value: 'qoq' },
              { label: tc('stat_comparison_yoy'), value: 'yoy' },
            ]}
            showSearch={false}
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
          <SelectField
            label={t('trend_good_direction')}
            hint={t('trend_good_direction_hint')}
            value={String(chartOptions.trendGoodDirection ?? 'up')}
            onChange={(v) => onUpdate('trendGoodDirection', v)}
            options={[
              { label: t('trend_good_up'), value: 'up' },
              { label: t('trend_good_down'), value: 'down' },
            ]}
            showSearch={false}
          />
        </>
      ) : null}
      <Collapse
        size="small"
        ghost
        className="pp-advanced-collapse"
        defaultActiveKey={hasTargets ? ['targets'] : []}
        items={[
          {
            key: 'targets',
            label: <span style={{ fontSize: 12 }}>{t('kpi_section_targets')}</span>,
            children: (
              <div className="stat-kpi-fields">
              <TextInputField
                label={t('stat_goal')}
                hint={t('stat_goal_hint')}
                value={chartOptions.goalTarget != null ? String(chartOptions.goalTarget) : ''}
                onChange={(v) => onUpdate('goalTarget', v === '' ? undefined : Number(v))}
                placeholder={t('stat_goal_placeholder')}
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
                showSearch={false}
              />
              <PpLabel>{t('conditional_formatting')}</PpLabel>
              <div style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', marginTop: -4, marginBottom: 4 }}>
                {t('stat_conditional_formatting_hint')}
              </div>
              <ConditionalFormattingEditor
                rules={(chartOptions.conditionalFormatting as ConditionalFormattingRule[]) ?? []}
                onChange={(rules) => onUpdate('conditionalFormatting', rules)}
                columnOptions={[{ label: t('stat_value_column'), value: 'value' }]}
              />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default StatKpiFields;
