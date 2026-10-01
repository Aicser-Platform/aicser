'use client';

import React from 'react';
import { Button, InputNumber, Segmented } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { CheckboxField, InputField } from './FormFields';
import { AdvancedCollapse } from './AdvancedCollapse';
import { getWidgetPropertyProfile } from './widgetPropertyProfile';
import type { ChartDesign } from '../widgets/chartDesign';

type RefLine = { value?: number; label?: string; axis?: 'x' | 'y'; color?: string };

/**
 * Format → Analytics (Power BI's analytics pane): trend, average, unusual values and reference
 * lines. One list of reference lines: lines saved by the older "Thresholds" control show here
 * too and move into it on the first edit, so a chart never has two ways to draw the same line.
 */
export function ChartAnalytics({
  chartType,
  chartOptions,
  orderedAxis,
  onUpdateChartOptions,
}: {
  chartType: string;
  chartOptions: Record<string, any>;
  /** The X axis has an order (dates, numbers): a trend or "unusual" point means something. */
  orderedAxis: boolean;
  onUpdateChartOptions: (updates: Record<string, any>) => void;
}) {
  const t = useTranslations('chart_options');
  const profile = getWidgetPropertyProfile(chartType);
  if (!profile.showOverlays || !['line', 'area', 'bar', 'scatter'].includes(chartType)) return null;

  const design: ChartDesign = chartOptions?.design || {};
  const legacy: RefLine[] = (design.marks?.lines || []).map((l) => ({
    value: l.value,
    label: l.label,
    axis: l.axis,
    color: l.color,
  }));
  const lines: RefLine[] = [...((chartOptions?.referenceLines as RefLine[]) || []), ...legacy];

  const writeLines = (next: RefLine[]) =>
    onUpdateChartOptions({
      referenceLines: next,
      ...(legacy.length ? { design: { ...design, marks: { ...(design.marks || {}), lines: [] } } } : {}),
    });

  const active =
    chartOptions?.showTrendLine === true ||
    chartOptions?.showAverageLine === true ||
    chartOptions?.showAnomalies === true ||
    lines.length > 0 ||
    design.marks?.pareto === true;

  return (
    <div className="pp-format-section">
      <AdvancedCollapse title={t('analytics')} active={active}>
        <div className="pp-format-stack">
          {orderedAxis || chartOptions?.showTrendLine === true ? (
            <CheckboxField
              label={t('analytics_trend')}
              hint={t('analytics_trend_tip')}
              checked={chartOptions?.showTrendLine === true}
              onChange={(v) => onUpdateChartOptions({ showTrendLine: v })}
            />
          ) : null}
          <CheckboxField
            label={t('analytics_average')}
            checked={chartOptions?.showAverageLine === true}
            onChange={(v) => onUpdateChartOptions({ showAverageLine: v })}
          />
          {orderedAxis || chartOptions?.showAnomalies === true ? (
            <CheckboxField
              label={t('analytics_unusual')}
              hint={t('analytics_unusual_tip')}
              checked={chartOptions?.showAnomalies === true}
              onChange={(v) => onUpdateChartOptions({ showAnomalies: v })}
            />
          ) : null}
          {chartType === 'scatter' ? (
            <CheckboxField
              label={t('design_pareto')}
              checked={design.marks?.pareto === true}
              onChange={(v) =>
                onUpdateChartOptions({ design: { ...design, marks: { ...(design.marks || {}), pareto: v } } })
              }
            />
          ) : null}

          <div className="pp-ref-lines">
            <div className="pp-ref-lines-head">
              <span>{t('reference_lines')}</span>
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => writeLines([...lines, { value: undefined, label: '' }])}
              >
                {t('reference_line_add')}
              </Button>
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="pp-ref-line-row">
                <InputNumber
                  size="small"
                  className="pp-ref-line-value"
                  placeholder={t('reference_line_value')}
                  aria-label={t('reference_line_value')}
                  value={line.value}
                  onChange={(v) => {
                    const next = [...lines];
                    next[idx] = { ...line, value: v === null ? undefined : Number(v) };
                    writeLines(next);
                  }}
                />
                <InputField
                  label=""
                  value={line.label ?? ''}
                  placeholder={t('reference_line_label')}
                  onChange={(v) => {
                    const next = [...lines];
                    next[idx] = { ...line, label: v || undefined };
                    writeLines(next);
                  }}
                />
                {chartType === 'scatter' ? (
                  <Segmented
                    size="small"
                    value={line.axis === 'x' ? 'x' : 'y'}
                    options={[
                      { label: 'Y', value: 'y' },
                      { label: 'X', value: 'x' },
                    ]}
                    onChange={(v) => {
                      const next = [...lines];
                      next[idx] = { ...line, axis: v as 'x' | 'y' };
                      writeLines(next);
                    }}
                  />
                ) : null}
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  aria-label={t('reference_line_remove')}
                  onClick={() => writeLines(lines.filter((_, i) => i !== idx))}
                />
              </div>
            ))}
          </div>
        </div>
      </AdvancedCollapse>
    </div>
  );
}
