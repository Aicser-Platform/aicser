'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button, Input } from 'antd';
import type { InputRef } from 'antd';
import { useTranslations } from 'next-intl';
import {
  CHART_CLICK_EVENT,
  WIDGET_OPTIONS_PATCH_EVENT,
  type ChartClickDetail,
  type WidgetOptionsPatchDetail,
} from '../widgets/inlineEditEvents';
import type { ChartAnnotation } from '../widgets/chartNotes';
import { makeCategoryLabelFormatter } from '../utils/numberFormatter';

type Editing =
  | { kind: 'axisTitle'; axis: 'x' | 'y'; x: number; y: number }
  | { kind: 'note'; category: string; x: number; y: number };

/**
 * Edit on the chart itself: click an axis title to rename it, click a bar or point to pin a
 * note to it. Text typed into the card (description, source) arrives here too. Changes go
 * through the panel's normal save (instant on screen, stored shortly after).
 */
export function ChartInlineEditor({
  widgetId,
  chartType,
  chartData,
  chartOptions,
  onPatch,
}: {
  widgetId?: string | null;
  chartType?: string;
  chartData?: { x?: unknown[] };
  chartOptions: Record<string, any>;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations('chart_options');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [text, setText] = useState('');
  const inputRef = useRef<InputRef>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(chartOptions);
  optionsRef.current = chartOptions;
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;
  // On a dashboard the first click on a chart selects its card; only a click on an already
  // selected chart offers a note.
  const selectedAt = useRef(Date.now());
  useEffect(() => {
    selectedAt.current = Date.now();
  }, [widgetId]);

  useEffect(() => {
    const onClick = (e: Event) => {
      const d = (e as CustomEvent<ChartClickDetail>).detail;
      if (!d || !widgetId || d.widgetId !== String(widgetId)) return;
      const o = optionsRef.current || {};
      if (d.kind === 'axisTitle') {
        const axis = d.axis === 'y' ? 'y' : 'x';
        setText(String((axis === 'x' ? o.xAxisLabel : o.yAxisLabel) ?? ''));
        setEditing({ kind: 'axisTitle', axis, x: d.clientX, y: d.clientY });
      } else if (
        d.kind === 'point' &&
        d.category != null &&
        ['bar', 'line', 'area'].includes(String(chartType)) &&
        Date.now() - selectedAt.current > 400
      ) {
        const existing = ((o.annotations as ChartAnnotation[]) || []).find(
          (a) => a.kind === 'note' && a.category === d.category,
        );
        setText(existing && existing.kind === 'note' ? existing.text : '');
        setEditing({ kind: 'note', category: d.category, x: d.clientX, y: d.clientY });
      }
    };
    const onOptions = (e: Event) => {
      const d = (e as CustomEvent<WidgetOptionsPatchDetail>).detail;
      if (d && widgetId && d.widgetId === String(widgetId)) onPatchRef.current(d.patch);
    };
    window.addEventListener(CHART_CLICK_EVENT, onClick);
    window.addEventListener(WIDGET_OPTIONS_PATCH_EVENT, onOptions);
    return () => {
      window.removeEventListener(CHART_CLICK_EVENT, onClick);
      window.removeEventListener(WIDGET_OPTIONS_PATCH_EVENT, onOptions);
    };
  }, [widgetId, chartType]);

  useEffect(() => {
    if (!editing) return;
    const id = window.setTimeout(() => inputRef.current?.focus({ cursor: 'all' }), 0);
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setEditing(null);
    };
    // Registered after this click finishes, so the click that opened the editor doesn't close it.
    const reg = window.setTimeout(() => document.addEventListener('mousedown', close), 0);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(reg);
      document.removeEventListener('mousedown', close);
    };
  }, [editing]);

  if (!editing) return null;

  const save = () => {
    const value = text.trim();
    if (editing.kind === 'axisTitle') {
      onPatch({ [editing.axis === 'x' ? 'xAxisLabel' : 'yAxisLabel']: value || undefined });
    } else {
      const list = ((optionsRef.current?.annotations as ChartAnnotation[]) || []).filter(
        (a) => !(a.kind === 'note' && a.category === editing.category),
      );
      const next = value ? [...list, { kind: 'note' as const, category: editing.category, text: value }] : list;
      onPatch({ annotations: next.length ? next : undefined });
    }
    setEditing(null);
  };

  const heading =
    editing.kind === 'axisTitle'
      ? t(editing.axis === 'x' ? 'inline_x_title' : 'inline_y_title')
      : t('inline_note_for', { name: makeCategoryLabelFormatter(chartData?.x as unknown[])(editing.category) });
  const left = Math.min(editing.x + 8, window.innerWidth - 280);
  const top = Math.min(editing.y + 8, window.innerHeight - 110);

  return (
    <div ref={boxRef} className="chart-inline-editor" style={{ left, top }} role="dialog" aria-label={heading}>
      <div className="chart-inline-editor-title">{heading}</div>
      <Input
        ref={inputRef}
        size="small"
        value={text}
        maxLength={editing.kind === 'note' ? 80 : 60}
        placeholder={editing.kind === 'note' ? t('annotation_note_placeholder') : t('axis_title_placeholder')}
        onChange={(e) => setText(e.target.value)}
        onPressEnter={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(null);
        }}
      />
      <div className="chart-inline-editor-actions">
        <Button size="small" type="text" onClick={() => setEditing(null)}>
          {t('inline_cancel')}
        </Button>
        <Button size="small" type="primary" onClick={save}>
          {t('inline_save')}
        </Button>
      </div>
    </div>
  );
}
