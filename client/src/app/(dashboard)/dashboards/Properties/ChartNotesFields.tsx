'use client';

import React from 'react';
import { Button, Input, Select } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { AdvancedCollapse } from './AdvancedCollapse';
import { makeCategoryLabelFormatter } from '../utils/numberFormatter';
import type { ChartAnnotation } from '../widgets/chartNotes';

const ANNOTATABLE = new Set(['bar', 'line', 'area']);

/**
 * Format → Annotations: notes pinned to a bar or point, and shaded highlights between two
 * categories. Notes can also be added by clicking a bar or point on the chart.
 */
export function ChartNotesFields({
  chartType,
  chartData,
  annotations,
  onChange,
}: {
  chartType: string;
  chartData?: { x?: unknown[] };
  annotations: ChartAnnotation[];
  onChange: (next: ChartAnnotation[] | undefined) => void;
}) {
  const t = useTranslations('chart_options');
  if (!ANNOTATABLE.has(chartType)) return null;
  const raw = (chartData?.x || []).map((v) => String(v ?? ''));
  const label = makeCategoryLabelFormatter(chartData?.x as unknown[]);
  const options = raw.map((v) => ({ value: v, label: label(v) }));
  const set = (next: ChartAnnotation[]) => onChange(next.length ? next : undefined);
  const update = (i: number, patch: Partial<ChartAnnotation>) =>
    set(annotations.map((a, j) => (j === i ? ({ ...a, ...patch } as ChartAnnotation) : a)));

  return (
    <div className="pp-format-section">
      <AdvancedCollapse title={t('annotations')} active={annotations.length > 0}>
        <div className="pp-notes">
          <p className="pp-notes-hint">{t('annotations_click_hint')}</p>
          {annotations.map((a, i) => (
            <div key={i} className="pp-note-row">
              {a.kind === 'note' ? (
                <>
                  <Select
                    size="small"
                    showSearch
                    optionFilterProp="label"
                    value={a.category}
                    options={options}
                    aria-label={t('annotation_at')}
                    onChange={(v) => update(i, { category: v })}
                  />
                  <Input
                    size="small"
                    value={a.text}
                    placeholder={t('annotation_note_placeholder')}
                    onChange={(e) => update(i, { text: e.target.value })}
                  />
                </>
              ) : (
                <>
                  <div className="pp-note-range">
                    <Select size="small" showSearch optionFilterProp="label" value={a.from} options={options} aria-label={t('axis_range_start')} onChange={(v) => update(i, { from: v })} />
                    <Select size="small" showSearch optionFilterProp="label" value={a.to} options={options} aria-label={t('axis_range_end')} onChange={(v) => update(i, { to: v })} />
                  </div>
                  <Input
                    size="small"
                    value={a.text ?? ''}
                    placeholder={t('annotation_highlight_placeholder')}
                    onChange={(e) => update(i, { text: e.target.value || undefined })}
                  />
                </>
              )}
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                aria-label={t('annotation_remove')}
                onClick={() => set(annotations.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          {raw.length ? (
            <div className="pp-notes-actions">
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => set([...annotations, { kind: 'note', category: raw[0], text: '' }])}
              >
                {t('annotation_add_note')}
              </Button>
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                onClick={() =>
                  set([...annotations, { kind: 'highlight', from: raw[0], to: raw[Math.min(1, raw.length - 1)] }])
                }
              >
                {t('annotation_add_highlight')}
              </Button>
            </div>
          ) : null}
        </div>
      </AdvancedCollapse>
    </div>
  );
}
