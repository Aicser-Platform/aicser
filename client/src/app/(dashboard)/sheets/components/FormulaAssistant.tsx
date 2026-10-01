'use client';

import React, { useState } from 'react';
import { Alert, Button, Input, Popover, Space, Typography } from 'antd';
import { BulbOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { Model } from '@ironcalc/wasm';
import type { DataRange } from '@/services/workbookService';
import { fetchApi } from '@/utils/api';
import { areaRef, columnLetters } from './sheetData';

const { Text } = Typography;
const PREVIEW_ROWS = 40;
const PREVIEW_COLS = 26;

/** The sheet as the AI sees it: addresses with their contents (formulas as written), plus each
 * data range's headers — so formulas refer to real cells, not guesses. */
export function sheetContext(model: Model, sheet: number, ranges: DataRange[], sheetName: (s: number) => string) {
  const lines: string[] = [];
  for (let r = 1; r <= PREVIEW_ROWS; r += 1) {
    for (let c = 1; c <= PREVIEW_COLS; c += 1) {
      const raw = model.getCellContent(sheet, r, c);
      // Text typed with a leading apostrophe (how data ranges keep text as text) reads as text.
      const v = raw.startsWith("'") ? raw.slice(1) : raw;
      if (v !== '') lines.push(`${columnLetters(c)}${r}: ${v.slice(0, 80)}`);
    }
  }
  const described = ranges.filter((x) => x.sheet === sheet).map((x) => ({
    name: x.name, area: areaRef(sheetName(sheet), x), header_row: x.row,
    columns: Array.from({ length: x.width }, (_, i) => model.getFormattedCellValue(sheet, x.row, x.column + i)),
  }));
  return { grid: lines.join('\n'), ranges: described };
}

type Preview = { sheet: number; row: number; column: number; before: string; formula: string; explanation: string; value: string };

/**
 * "Describe a formula": the AI writes one for the selected cell; it is put in the cell as a
 * preview showing its value, and stays only if the person keeps it.
 */
export function FormulaAssistant({
  model, ranges, sheetName, onChanged,
}: {
  model: Model;
  ranges: DataRange[];
  sheetName: (s: number) => string;
  onChanged: () => void;
}) {
  const t = useTranslations('sheets');
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const put = (p: { sheet: number; row: number; column: number }, content: string) => {
    if (content === '') model.rangeClearContents(p.sheet, p.row, p.column, p.row, p.column);
    else model.setUserInput(p.sheet, p.row, p.column, content);
    model.evaluate();
    onChanged();
  };

  const ask = async (retry?: Preview) => {
    const v = model.getSelectedView();
    const at = retry ?? { sheet: v.sheet, row: v.row, column: v.column, before: model.getCellContent(v.sheet, v.row, v.column) };
    setBusy(true);
    setError(null);
    try {
      const ctx = sheetContext(model, at.sheet, ranges, sheetName);
      const res = await fetchApi<{ formula: string; explanation: string }>('/api/ai/workbook/formula', {
        method: 'POST',
        body: JSON.stringify({
          request, sheet: sheetName(at.sheet), cell: `${columnLetters(at.column)}${at.row}`, ...ctx,
          previous: retry?.formula, error: retry?.value,
        }),
      });
      put(at, res.formula);
      setPreview({ ...at, formula: res.formula, explanation: res.explanation,
        value: model.getFormattedCellValue(at.sheet, at.row, at.column) });
    } catch (err) {
      if (retry) put(retry, retry.before);
      setPreview(null);
      setError(err instanceof Error ? err.message : t('formula_failed'));
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    if (preview) put(preview, preview.before);
    setPreview(null);
  };

  const close = (next: boolean) => {
    if (!next && preview) discard();
    setOpen(next);
  };

  const failed = preview?.value.startsWith('#');

  return (
    <Popover
      open={open}
      onOpenChange={close}
      trigger="click"
      placement="bottomRight"
      title={t('formula_title')}
      content={
        <div className="wb-formula">
          {!preview ? (
            <>
              <Input.TextArea
                autoFocus
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                autoSize={{ minRows: 2, maxRows: 5 }}
                placeholder={t('formula_placeholder')}
                onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); if (request.trim()) void ask(); } }}
              />
              <Text type="secondary" className="wb-formula__note">{t('formula_note')}</Text>
              {error ? <Alert type="warning" showIcon message={error} /> : null}
              <Button type="primary" icon={<BulbOutlined />} loading={busy} disabled={!request.trim()} onClick={() => void ask()}>
                {t('formula_write')}
              </Button>
            </>
          ) : (
            <>
              <code className="wb-formula__code">{preview.formula}</code>
              {preview.explanation ? <Text type="secondary">{preview.explanation}</Text> : null}
              <Text>
                {t('formula_result', { cell: `${columnLetters(preview.column)}${preview.row}` })}{' '}
                <Text strong type={failed ? 'danger' : undefined}>{preview.value || '—'}</Text>
              </Text>
              <Space wrap>
                {failed ? (
                  <Button type="primary" loading={busy} onClick={() => void ask(preview)}>{t('formula_fix')}</Button>
                ) : (
                  <Button type="primary" onClick={() => { setPreview(null); setRequest(''); setOpen(false); }}>{t('formula_keep')}</Button>
                )}
                <Button onClick={discard}>{t('formula_discard')}</Button>
              </Space>
            </>
          )}
        </div>
      }
    >
      <Button icon={<BulbOutlined />}>{t('formula_button')}</Button>
    </Popover>
  );
}
