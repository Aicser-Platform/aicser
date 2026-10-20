'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Input, Popover, Segmented, Space, Typography, message } from 'antd';
import { BulbOutlined, ReadOutlined, TranslationOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { Model } from '@ironcalc/wasm';
import type { DataRange } from '@/services/workbookService';
import { fetchApi } from '@/utils/api';
import { areaRef, columnLetters } from './sheetData';
import { buildWorkbookFormulaContext } from './sheetFormulaContext';
import { selectedCellExplainPayload } from './sheetCellExplain';
import { postFormulaExplanationComment } from './sheetFormulaComment';

const { Text } = Typography;
const PREVIEW_ROWS = 40;
const PREVIEW_COLS = 26;

/** Legacy single-sheet preview (tests). */
export function sheetContext(model: Model, sheet: number, ranges: DataRange[], sheetName: (s: number) => string) {
  const lines: string[] = [];
  for (let r = 1; r <= PREVIEW_ROWS; r += 1) {
    for (let c = 1; c <= PREVIEW_COLS; c += 1) {
      const raw = model.getCellContent(sheet, r, c);
      const v = raw.startsWith("'") ? raw.slice(1) : raw;
      if (v !== '') lines.push(`${columnLetters(c)}${r}: ${v.slice(0, 80)}`);
    }
  }
  const described = ranges.filter((x) => x.sheet === sheet).map((x) => ({
    name: x.name,
    area: areaRef(sheetName(sheet), x),
    header_row: x.row,
    columns: Array.from({ length: x.width }, (_, i) => model.getFormattedCellValue(sheet, x.row, x.column + i)),
  }));
  return { grid: lines.join('\n'), ranges: described };
}

type Preview = {
  sheet: number;
  row: number;
  column: number;
  before: string;
  formula: string;
  explanation: string;
  value: string;
};

type ExplainResult = {
  plain_summary: string;
  steps: string[];
  references: string[];
  result_meaning?: string;
};

export function FormulaAssistantPanel({
  model,
  ranges,
  sheetName,
  onChanged,
  activeCellLabel,
  onDone,
  autoFocus = true,
  subMode: subModeProp = 'write',
  workbookId,
  attachExplanationAsComment,
  onCellNotePosted,
}: {
  model: Model;
  ranges: DataRange[];
  sheetName: (s: number) => string;
  onChanged: () => void;
  activeCellLabel?: string;
  onDone?: () => void;
  autoFocus?: boolean;
  /** Write new formula vs explain / translate selected cell */
  subMode?: 'write' | 'explain';
  workbookId?: string;
  attachExplanationAsComment?: boolean;
  /** Opens the workbook Comments drawer after a cell note is saved. */
  onCellNotePosted?: () => void;
}) {
  const t = useTranslations('sheets');
  const locale = useLocale();
  const [subMode, setSubMode] = useState<'write' | 'explain'>(subModeProp);
  useEffect(() => {
    setSubMode(subModeProp);
  }, [subModeProp]);

  const cellSnap = useMemo(
    () => selectedCellExplainPayload(model, sheetName),
    [model, sheetName, activeCellLabel],
  );

  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const [attachComment, setAttachComment] = useState(attachExplanationAsComment ?? true);

  const postComment = async (text: string, force = false) => {
    if (!workbookId || !activeCellLabel) return;
    if (!force && !attachComment) return;
    try {
      await postFormulaExplanationComment(workbookId, activeCellLabel, text);
      onCellNotePosted?.();
      message.success(t('formula_comment_posted'));
    } catch {
      message.error(t('formula_comment_failed'));
    }
  };

  const formatExplainForComment = (ex: ExplainResult) => {
    const parts: string[] = [];
    if (cellSnap.cell_formula) parts.push(`Formula:\n${cellSnap.cell_formula}`);
    else if (cellSnap.cell_value) parts.push(`Value: ${cellSnap.cell_value}`);
    parts.push(ex.plain_summary);
    if (ex.result_meaning) parts.push(ex.result_meaning);
    if (ex.steps?.length) parts.push(ex.steps.map((s) => `• ${s}`).join('\n'));
    return parts.filter(Boolean).join('\n\n');
  };

  const put = (p: { sheet: number; row: number; column: number }, content: string) => {
    if (content === '') model.rangeClearContents(p.sheet, p.row, p.column, p.row, p.column);
    else model.setUserInput(p.sheet, p.row, p.column, content);
    model.evaluate();
    onChanged();
  };

  const ask = async (retry?: Preview) => {
    const v = model.getSelectedView();
    const at = retry ?? {
      sheet: v.sheet,
      row: v.row,
      column: v.column,
      before: model.getCellContent(v.sheet, v.row, v.column),
    };
    setBusy(true);
    setError(null);
    try {
      const ctx = buildWorkbookFormulaContext(model, ranges, sheetName);
      const res = await fetchApi<{ formula: string; explanation: string }>('/api/ai/workbook/formula', {
        method: 'POST',
        body: JSON.stringify({
          request,
          sheet: sheetName(at.sheet),
          cell: `${columnLetters(at.column)}${at.row}`,
          ...ctx,
          previous: retry?.formula,
          error: retry?.value,
        }),
      });
      put(at, res.formula);
      setPreview({
        ...at,
        formula: res.formula,
        explanation: res.explanation,
        value: model.getFormattedCellValue(at.sheet, at.row, at.column),
      });
      if (attachComment && workbookId && res.explanation) {
        await postComment(`[Formula]\n${res.formula}\n\n${res.explanation}`);
      }
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

  const explainCell = async (intent: 'explain' | 'translate' | 'audit') => {
    setBusy(true);
    setError(null);
    setExplain(null);
    try {
      const ctx = buildWorkbookFormulaContext(model, ranges, sheetName);
      const res = await fetchApi<ExplainResult & { success?: boolean }>('/api/ai/workbook/formula/explain', {
        method: 'POST',
        body: JSON.stringify({
          ...ctx,
          ...cellSnap,
          intent,
          locale,
        }),
      });
      const summary = res.plain_summary?.trim();
      if (!summary) {
        throw new Error(t('formula_explain_failed'));
      }
      setExplain({
        plain_summary: summary,
        steps: res.steps ?? [],
        references: res.references ?? [],
        result_meaning: res.result_meaning,
      });
      if (attachComment && workbookId) {
        await postComment(formatExplainForComment(res));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('formula_explain_failed'));
    } finally {
      setBusy(false);
    }
  };

  const failed = preview?.value.startsWith('#');
  const hasCellContent = Boolean(cellSnap.cell_formula || cellSnap.cell_value);

  return (
    <div className="wb-formula">
      <Segmented
        block
        size="small"
        style={{ marginBottom: 10 }}
        value={subMode}
        onChange={(v) => {
          setSubMode(v as 'write' | 'explain');
          setPreview(null);
          setExplain(null);
          setError(null);
        }}
        options={[
          { value: 'write', label: t('formula_mode_write'), icon: <BulbOutlined /> },
          { value: 'explain', label: t('formula_mode_explain'), icon: <ReadOutlined /> },
        ]}
      />
      {workbookId ? (
        <>
          <Checkbox
            checked={attachComment}
            onChange={(e) => setAttachComment(e.target.checked)}
            style={{ marginBottom: 4, fontSize: 12 }}
          >
            {t('formula_attach_comment')}
          </Checkbox>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 11 }}>
            {t('formula_cell_note_where')}
          </Text>
        </>
      ) : null}
      {activeCellLabel ? (
        <Text type="secondary" className="wb-formula__target">
          {t('formula_target_cell', { cell: activeCellLabel })}
        </Text>
      ) : null}
      {subMode === 'explain' ? (
        <>
          {cellSnap.cell_formula ? (
            <code className="wb-formula__code">{cellSnap.cell_formula}</code>
          ) : cellSnap.cell_value ? (
            <Text>
              <Text type="secondary">{t('formula_explain_value_label')}</Text>{' '}
              <Text strong>{cellSnap.cell_value}</Text>
            </Text>
          ) : (
            <Alert type="info" showIcon message={t('formula_explain_empty')} />
          )}
          <Space wrap style={{ marginTop: 8 }}>
            <Button
              type="primary"
              icon={<ReadOutlined />}
              loading={busy}
              disabled={!hasCellContent}
              onClick={() => void explainCell('explain')}
            >
              {t('formula_explain_btn')}
            </Button>
            <Button
              icon={<TranslationOutlined />}
              loading={busy}
              disabled={!hasCellContent}
              onClick={() => void explainCell('translate')}
            >
              {t('formula_translate_btn')}
            </Button>
            {cellSnap.cell_formula ? (
              <Button loading={busy} onClick={() => void explainCell('audit')}>
                {t('formula_audit_btn')}
              </Button>
            ) : null}
          </Space>
          {error ? <Alert type="warning" showIcon message={error} style={{ marginTop: 8 }} /> : null}
          {explain ? (
            <div className="wb-formula__explain" style={{ marginTop: 10 }}>
              <Text>{explain.plain_summary}</Text>
              {explain.result_meaning ? (
                <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
                  {t('formula_explain_result')}: {explain.result_meaning}
                </Text>
              ) : null}
              {explain.steps?.length ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {explain.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : null}
              {explain.references?.length ? (
                <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 11 }}>
                  {t('formula_explain_refs')}: {explain.references.join(' · ')}
                </Text>
              ) : null}
              {workbookId && explain && !attachComment ? (
                <Button
                  size="small"
                  style={{ marginTop: 8 }}
                  onClick={() => void postComment(formatExplainForComment(explain), true)}
                >
                  {t('formula_post_comment')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      {subMode === 'write' && !preview ? (
        <>
          <Input.TextArea
            autoFocus={autoFocus}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 5 }}
            placeholder={t('formula_placeholder')}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                if (request.trim()) void ask();
              }
            }}
          />
          <Text type="secondary" className="wb-formula__note">{t('formula_note_workbook')}</Text>
          <div className="wb-formula__lookup">
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{t('formula_lookup_title')}</Text>
            <Space wrap size={4}>
              <Button
                size="small"
                onClick={() => {
                  const v = model.getSelectedView();
                  put(
                    { sheet: v.sheet, row: v.row, column: v.column },
                    '=VLOOKUP(lookup_value, lookup_table, column_index, FALSE)',
                  );
                  setRequest(t('formula_lookup_vlookup_hint'));
                }}
              >
                {t('formula_lookup_vlookup')}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  const v = model.getSelectedView();
                  put(
                    { sheet: v.sheet, row: v.row, column: v.column },
                    '=XLOOKUP(lookup_value, lookup_column, return_column, not_found, 0, 1)',
                  );
                  setRequest(t('formula_lookup_xlookup_hint'));
                }}
              >
                {t('formula_lookup_xlookup')}
              </Button>
            </Space>
            <Text type="secondary" style={{ fontSize: 11 }}>{t('formula_lookup_live_hint')}</Text>
          </div>
          {error ? <Alert type="warning" showIcon message={error} /> : null}
          <Button
            type="primary"
            icon={<BulbOutlined />}
            loading={busy}
            disabled={!request.trim()}
            onClick={() => void ask()}
          >
            {t('formula_write')}
          </Button>
        </>
      ) : null}
      {subMode === 'write' && preview ? (
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
              <Button
                type="primary"
                onClick={() => {
                  if (preview.explanation && attachComment && workbookId) {
                    void postComment(`[Formula]\n${preview.formula}\n\n${preview.explanation}`);
                  }
                  setPreview(null);
                  setRequest('');
                  onDone?.();
                }}
              >
                {t('formula_keep')}
              </Button>
            )}
            <Button onClick={discard}>{t('formula_discard')}</Button>
          </Space>
        </>
      ) : null}
    </div>
  );
}

export function FormulaAssistant({
  model,
  ranges,
  sheetName,
  onChanged,
  activeCellLabel,
  open,
  onOpenChange,
  showTrigger = true,
}: {
  model: Model;
  ranges: DataRange[];
  sheetName: (s: number) => string;
  onChanged: () => void;
  activeCellLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const t = useTranslations('sheets');
  const [internalOpen, setInternalOpen] = useState(false);
  const popoverOpen = open ?? internalOpen;
  const setPopoverOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (open === undefined) setInternalOpen(next);
  };

  const close = (next: boolean) => {
    setPopoverOpen(next);
  };

  return (
    <Popover
      open={popoverOpen}
      onOpenChange={close}
      trigger="click"
      placement="bottomRight"
      title={t('formula_title')}
      content={
        <FormulaAssistantPanel
          model={model}
          ranges={ranges}
          sheetName={sheetName}
          onChanged={onChanged}
          activeCellLabel={activeCellLabel}
          onDone={() => setPopoverOpen(false)}
        />
      }
    >
      {showTrigger ? (
        <Button icon={<BulbOutlined />}>{t('formula_button')}</Button>
      ) : (
        <span className="wb-formula__anchor" aria-hidden />
      )}
    </Popover>
  );
}
