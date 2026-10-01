'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import MarkdownRenderer from '@/components/ui/markdown/MarkdownRenderer';
import { Button, Checkbox, Dropdown, Input, Segmented, Select, Space, Tag, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreAddOutlined, ArrowDownOutlined, ArrowUpOutlined, BarChartOutlined, DashboardOutlined, TableOutlined, BorderBottomOutlined, BorderTopOutlined, CaretRightOutlined,
  ClockCircleOutlined, CodeOutlined, ConsoleSqlOutlined, DownloadOutlined, DeleteOutlined, FileTextOutlined, MoreOutlined,
  RobotOutlined, StopOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ChartSpec, NotebookCell as Cell, CellType } from '@/services/notebookService';
import { CellOutputView, type OutputAction } from './CellOutputView';
import { NotebookChart, defaultAgg } from './NotebookChart';
import { PivotView } from './PivotView';
import { AGGS } from './chartShape';
import { bindModelSchema, defineNotebookThemes, registerSqlCompletion, schemaFor } from './sqlCompletion';
import { registerPythonCompletion } from './pythonCompletion';
import { registerInlineAi } from './inlineAi';

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });
const { Text } = Typography;

export type ResultInfo = { name: string; columns: string[]; rows?: number };
export type EditorHandle = { focus: () => void; insert: (text: string) => void };

export const TYPE_ICON: Record<CellType, React.ReactNode> = {
  sql: <ConsoleSqlOutlined />,
  python: <CodeOutlined />,
  markdown: <FileTextOutlined />,
  chart: <BarChartOutlined />,
  pivot: <TableOutlined />,
};

/** A small labelled control, so chart and pivot settings read as a form, not a row of boxes. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="nb-field">
      <span className="nb-field__label">{label}</span>
      {children}
    </label>
  );
}

const LINE = 19;

type Props = {
  cell: Cell;
  index: number;
  count: number;
  readOnly: boolean;
  running: boolean;
  /** Selected in command mode (keyboard navigation). */
  selected?: boolean;
  /** Something else is running, so this cell waits its turn. */
  busy: boolean;
  dark: boolean;
  execCount?: number;
  stale: boolean;
  dataSources: Array<{ value: string; label: string }>;
  results: ResultInfo[];
  chartData?: { columns: string[]; rows: unknown[][]; row_count?: number } | null;
  /** For a chart whose data isn't loaded: the cell that makes it, if any. */
  chartProducer?: { id: string; name: string } | null;
  liveImages?: string[];
  aiAvailable: boolean;
  onChange: (patch: Partial<Cell>) => void;
  onPickChartSource: (from: string) => void;
  onRun: (advance: boolean) => void;
  /** Alt+Enter: run, then insert a new cell below. */
  onRunInsert?: () => void;
  /** Esc from the editor: leave editing, keep the cell selected (command mode). */
  onEscape?: () => void;
  onSaveNow?: () => void;
  onStop: () => void;
  onRunRange: (range: 'above' | 'below') => void;
  onRunCell: (id: string) => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
  onAskAi: (prompt: string) => Promise<void>;
  onOutputAction: (action: OutputAction) => void;
  onFocus: () => void;
  /** Charts and pivots: save to the chart library or add to a dashboard, with their data. */
  onPublish?: (target: 'library' | 'dashboard') => void;
  registerEditor: (handle: EditorHandle | null) => void;
};

export function NotebookCell(props: Props) {
  const { cell, readOnly, running, dark, onChange } = props;
  const t = useTranslations('notebooks');
  const [editingText, setEditingText] = useState(!cell.source && cell.type === 'markdown');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [height, setHeight] = useState(Math.min(Math.max((cell.source || '').split('\n').length, 2), 30) * LINE + 12);
  const runRef = useRef(props.onRun);
  const keysRef = useRef({ insert: props.onRunInsert, escape: props.onEscape, save: props.onSaveNow });
  keysRef.current = { insert: props.onRunInsert, escape: props.onEscape, save: props.onSaveNow };
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);
  useEffect(() => {
    runRef.current = props.onRun;
  });

  const code = cell.type === 'sql' || cell.type === 'python';

  // Table and column suggestions follow the data the cell reads.
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (cell.type !== 'sql' || !model) return;
    const uri = model.uri.toString();
    if (!cell.data_source_id) {
      bindModelSchema(uri, null);
      return;
    }
    let live = true;
    void schemaFor(cell.data_source_id).then((schema) => { if (live) bindModelSchema(uri, schema); });
    return () => { live = false; };
  }, [cell.type, cell.data_source_id]);

  useEffect(() => () => props.registerEditor(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (cell.type !== 'markdown' || readOnly) return;
    props.registerEditor({ focus: () => setEditingText(true), insert: () => undefined });
  }, [cell.type, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const publishable = (cell.type === 'chart' || cell.type === 'pivot') && Boolean(cell.chart?.from) && Boolean(props.onPublish);
  // Same exports as the chart library and dashboards: screen PNG, print-quality PNG, vector SVG.
  const downloadChart = async (type: 'png' | 'png-print' | 'svg') => {
    const el = document.querySelector(`[data-cell-id="${cell.id}"] .nb-chart-canvas`) as HTMLElement | null;
    const echarts = await import('echarts');
    const chart = el ? echarts.getInstanceByDom(el) : undefined;
    if (!chart) return;
    const { exportChartInstance } = await import('@/app/(dashboard)/dashboards/services/exportChartImageService');
    const title = (cell.chart as { title?: string } | undefined)?.title || cell.name || 'Chart';
    await exportChartInstance(chart, title, type);
  };
  const moreItems: MenuProps['items'] = [
    ...(publishable ? [
      { key: 'library', icon: <AppstoreAddOutlined />, label: t('save_to_library') },
      { key: 'dashboard', icon: <DashboardOutlined />, label: t('add_to_dashboard') },
      { type: 'divider' as const },
    ] : []),
    ...(cell.type === 'chart' ? [
      {
        key: 'download',
        icon: <DownloadOutlined />,
        label: t('download_chart'),
        children: [
          { key: 'img:png', label: 'PNG' },
          { key: 'img:png-print', label: t('download_png_print') },
          { key: 'img:svg', label: t('download_svg') },
        ],
      },
      { type: 'divider' as const },
    ] : []),
    { key: 'above', icon: <BorderTopOutlined />, label: t('run_above'), disabled: props.index === 0 || props.busy },
    { key: 'below', icon: <BorderBottomOutlined />, label: t('run_below'), disabled: props.busy },
    { type: 'divider' },
    { key: 'up', icon: <ArrowUpOutlined />, label: t('move_up'), disabled: props.index === 0 || readOnly },
    { key: 'down', icon: <ArrowDownOutlined />, label: t('move_down'), disabled: props.index === props.count - 1 || readOnly },
    ...(readOnly ? [] : [{ type: 'divider' as const }, { key: 'delete', icon: <DeleteOutlined />, label: t('delete_cell'), danger: true }]),
  ];

  const askAi = async () => {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    try {
      await props.onAskAi(aiPrompt.trim());
      setAiOpen(false);
      setAiPrompt('');
    } finally {
      setAiBusy(false);
    }
  };

  const spec: ChartSpec = cell.chart || {};
  const source = props.results.find((r) => r.name === spec.from);
  const columns = source?.columns ?? props.chartData?.columns ?? [];
  const colOptions = columns.map((c) => ({ value: c, label: c }));
  // Split by a grouping, never by the value being summed or the x axis itself, and only a column
  // with few enough distinct values to read as separate series (≤ 30).
  const splitOptions = React.useMemo(() => {
    const data = props.chartData;
    return columns
      .filter((c) => c !== spec.x && !(spec.y ?? []).includes(c))
      .filter((c) => {
        if (!data) return true;
        const i = data.columns.indexOf(c);
        if (i < 0) return true;
        const seen = new Set<string>();
        for (const r of data.rows.slice(0, 2000)) {
          seen.add(String(r[i]));
          if (seen.size > 30) return false;
        }
        return true;
      })
      .map((c) => ({ value: c, label: c }));
  }, [columns, spec.x, spec.y, props.chartData]);
  const runnable = cell.type === 'sql' ? Boolean(cell.data_source_id && cell.source.trim()) : cell.type === 'python' ? Boolean(cell.source.trim()) : false;

  return (
    <section
      className={`nb-cell nb-cell--${cell.type}${running ? ' nb-cell--running' : ''}${props.stale ? ' nb-cell--stale' : ''}${props.selected ? ' nb-cell--selected' : ''}`}
      aria-label={t(`type_${cell.type}`)}
      data-cell-id={cell.id}
      onFocusCapture={props.onFocus}
      onMouseDown={() => props.onEscape?.()}
    >
      <header className="nb-cell__bar">
        <Space size={6} wrap>
          {code && (running || props.execCount) ? (
            <span className="nb-cell__count" title={t('run_count_help')} aria-label={t('run_count_help')}>
              {running ? '[*]' : props.execCount ? `[${props.execCount}]` : ''}
            </span>
          ) : null}
          <Tag icon={TYPE_ICON[cell.type]} bordered={false}>{t(`type_${cell.type}`)}</Tag>
          {cell.type === 'sql' ? (
            <Select
              size="small"
              showSearch
              optionFilterProp="label"
              style={{ minWidth: 180 }}
              placeholder={t('choose_data')}
              value={cell.data_source_id || undefined}
              options={props.dataSources}
              labelRender={({ label, value }) => label ?? (value ? t('data_unavailable') : null)}
              status={cell.data_source_id && !props.dataSources.some((d) => d.value === cell.data_source_id) ? 'warning' : undefined}
              disabled={readOnly}
              onChange={(v) => onChange({ data_source_id: v })}
              aria-label={t('choose_data')}
            />
          ) : null}
          {cell.type === 'sql' ? (
            <Tooltip title={t('result_name_help')}>
              <Input
                size="small"
                prefix={<Text type="secondary" style={{ fontSize: 12 }}>{t('as')}</Text>}
                style={{ width: 130 }}
                value={cell.name || ''}
                disabled={readOnly}
                onChange={(e) => onChange({ name: e.target.value.replace(/[^A-Za-z0-9_]/g, '').replace(/^[0-9]+/, '').slice(0, 40) || null })}
                aria-label={t('result_name')}
              />
            </Tooltip>
          ) : null}
          {props.stale ? (
            <Tooltip title={t('stale_help')}>
              <Tag bordered={false} color="warning" icon={<ClockCircleOutlined />}>{t('stale')}</Tag>
            </Tooltip>
          ) : null}
        </Space>
        <Space size={4}>
          {code && props.aiAvailable && !readOnly ? (
            <span className={aiOpen ? undefined : 'nb-cell__secondary'}>
              <Button size="small" type={aiOpen ? 'default' : 'text'} icon={<RobotOutlined />} onClick={() => setAiOpen((v) => !v)}>
                {t('ask_ai')}
              </Button>
            </span>
          ) : null}
          {code ? (
            running ? (
              <Button size="small" danger icon={<StopOutlined />} onClick={props.onStop}>{t('stop')}</Button>
            ) : (
              <Tooltip title={`${t('run_cell_keys')}`}>
                <Button
                  size="small"
                  icon={<CaretRightOutlined />}
                  disabled={!runnable || props.busy}
                  onClick={() => props.onRun(false)}
                >
                  {t('run')}
                </Button>
              </Tooltip>
            )
          ) : null}
          <Dropdown
            trigger={['click']}
            menu={{
              items: moreItems,
              onClick: ({ key }) => {
                if (key === 'library' || key === 'dashboard') props.onPublish?.(key);
                if (key.startsWith('img:')) void downloadChart(key.slice(4) as 'png' | 'png-print' | 'svg');
                if (key === 'above' || key === 'below') props.onRunRange(key);
                if (key === 'up') props.onMove(-1);
                if (key === 'down') props.onMove(1);
                if (key === 'delete') props.onDelete();
              },
            }}
          >
            <Button size="small" type="text" className="nb-cell__secondary" icon={<MoreOutlined />} aria-label={t('cell_menu')} />
          </Dropdown>
        </Space>
      </header>

      {aiOpen ? (
        <div className="nb-cell__ai">
          <Input.Search
            autoFocus
            placeholder={cell.type === 'sql' ? t('ai_placeholder_sql') : t('ai_placeholder_python')}
            enterButton={t('ai_write')}
            loading={aiBusy}
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onSearch={() => void askAi()}
            onKeyDown={(e) => { if (e.key === 'Escape') setAiOpen(false); }}
          />
        </div>
      ) : null}

      {code ? (
        <div className="nb-cell__editor">
          <Editor
            height={height}
            language={cell.type === 'sql' ? 'sql' : 'python'}
            theme={dark ? 'aicser-dark' : 'aicser-light'}
            value={cell.source}
            onChange={(v) => onChange({ source: v ?? '' })}
            beforeMount={(monaco) => {
              defineNotebookThemes(monaco as never);
              registerSqlCompletion(monaco as never);
              registerPythonCompletion(monaco as never);
              registerInlineAi(monaco as never);
            }}
            onMount={(editor, monaco) => {
              editorRef.current = editor as never;
              // Shift+Enter runs and moves on (like Jupyter); Ctrl/Cmd+Enter runs in place.
              editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => runRef.current(true));
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current(false));
              editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Enter, () => keysRef.current.insert?.());
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => keysRef.current.save?.());
              // Esc leaves the editor for command mode, unless it's closing a suggestion or search.
              editor.addCommand(monaco.KeyCode.Escape, () => {
                (document.activeElement as HTMLElement | null)?.blur();
                keysRef.current.escape?.();
              }, '!suggestWidgetVisible && !findWidgetVisible && !parameterHintsVisible && !inlineSuggestionVisible');
              const fit = () => setHeight(Math.min(Math.max(editor.getContentHeight(), 2 * LINE + 12), 30 * LINE + 12));
              editor.onDidContentSizeChange(fit);
              fit();
              props.registerEditor({
                focus: () => {
                  editor.focus();
                  editor.revealLineInCenterIfOutsideViewport(1);
                },
                insert: (text) => {
                  const selection = editor.getSelection();
                  if (!selection) return;
                  editor.executeEdits('notebook-insert', [{ range: selection, text, forceMoveMarkers: true }]);
                  editor.focus();
                },
              });
              if (cell.type === 'sql' && cell.data_source_id) {
                const uri = editor.getModel()?.uri.toString();
                if (uri) void schemaFor(cell.data_source_id).then((schema) => bindModelSchema(uri, schema));
              }
            }}
            options={{
              readOnly,
              minimap: { enabled: false },
              // Suggestions, hovers and parameter hints float above the page — the cell's
              // rounded editor box clips its overflow, which cut the suggestion list to a strip.
              fixedOverflowWidgets: true,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              fontSize: 13,
              lineHeight: LINE,
              wordWrap: 'on',
              lineNumbers: 'on',
              lineNumbersMinChars: 3,
              folding: false,
              glyphMargin: false,
              renderLineHighlight: 'none',
              overviewRulerLanes: 0,
              hideCursorInOverviewRuler: true,
              scrollbar: { alwaysConsumeMouseWheel: false, vertical: 'auto' },
              padding: { top: 6, bottom: 6 },
              quickSuggestions: cell.type === 'sql' ? { other: true, strings: false, comments: false } : true,
              inlineSuggest: { enabled: true, mode: 'subwordSmart' },
              ariaLabel: t(`type_${cell.type}`),
            }}
          />
          {!cell.source && !readOnly ? (
            <div className="nb-cell__placeholder" aria-hidden>
              {cell.type === 'sql'
                ? (props.aiAvailable ? t('placeholder_sql_ai') : t('placeholder_sql'))
                : (props.aiAvailable ? t('placeholder_python_ai') : t('placeholder_python'))}
            </div>
          ) : null}
        </div>
      ) : null}

      {cell.type === 'markdown' ? (
        editingText && !readOnly ? (
          <div className="nb-cell__text-edit">
            <Input.TextArea
              variant="borderless"
              autoFocus
              autoSize={{ minRows: 3, maxRows: 20 }}
              value={cell.source}
              placeholder={t('text_placeholder')}
              onChange={(e) => onChange({ source: e.target.value })}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) || e.key === 'Escape') {
                  e.preventDefault();
                  setEditingText(false);
                  if (e.key === 'Escape') keysRef.current.escape?.();
                  else if (e.shiftKey) runRef.current(true); // Shift+Enter moves on, as in code cells
                }
              }}
            />
            <Button size="small" type="link" onClick={() => setEditingText(false)}>{t('done')}</Button>
          </div>
        ) : (
          <div
            className="nb-cell__markdown"
            role={readOnly ? undefined : 'button'}
            tabIndex={readOnly ? undefined : 0}
            onDoubleClick={() => !readOnly && setEditingText(true)}
            onKeyDown={(e) => { if (!readOnly && e.key === 'Enter') setEditingText(true); }}
            aria-label={readOnly ? undefined : t('edit_text')}
          >
            {cell.source ? <MarkdownRenderer content={cell.source} /> : <Text type="secondary">{t('text_empty')}</Text>}
          </div>
        )
      ) : null}

      {cell.type === 'chart' || cell.type === 'pivot' ? (
        <div className="nb-cell__chart">
          <div className="nb-chart-controls">
            <Select
              size="small"
              style={{ minWidth: 150 }}
              placeholder={t('chart_from')}
              value={spec.from}
              disabled={readOnly}
              options={props.results.map((r) => ({ value: r.name, label: r.name }))}
              onChange={(from) => props.onPickChartSource(from)}
              aria-label={t('chart_from')}
              notFoundContent={t('chart_needs_result')}
            />
            {cell.type === 'chart' ? (
              <Segmented
                size="small"
                value={spec.type || 'bar'}
                disabled={readOnly}
                options={(['bar', 'line', 'area', 'pie', 'scatter'] as const).map((k) => ({ value: k, label: t(`chart_${k}`) }))}
                onChange={(type) => onChange({ chart: { ...spec, type: type as ChartSpec['type'] } })}
              />
            ) : null}
          </div>
          {cell.type === 'chart' ? (
            <div className="nb-chart-controls">
              <Field label={t('chart_x')}>
                <Select size="small" style={{ minWidth: 140 }} value={spec.x} disabled={readOnly || !columns.length}
                  options={colOptions} showSearch onChange={(x) => onChange({ chart: { ...spec, x } })} aria-label={t('chart_x')} />
              </Field>
              <Field label={t('chart_y')}>
                <Select size="small" mode="multiple" style={{ minWidth: 170 }} value={spec.y ?? []} disabled={readOnly || !columns.length}
                  maxTagCount="responsive" options={colOptions} onChange={(y) => onChange({ chart: { ...spec, y } })} aria-label={t('chart_y')} />
              </Field>
              <Field label={t('summarize')}>
                <Select size="small" style={{ width: 120 }} value={defaultAgg(spec)} disabled={readOnly}
                  options={AGGS.map((k) => ({ value: k, label: t(`agg_${k}`) }))}
                  onChange={(agg) => onChange({ chart: { ...spec, agg } })} aria-label={t('summarize')} />
              </Field>
              {spec.type !== 'pie' ? (
                <Field label={t('split_by')}>
                  <Select size="small" style={{ minWidth: 130 }} allowClear placeholder={t('none')} value={spec.series ?? undefined}
                    disabled={readOnly || !columns.length} options={splitOptions}
                    onChange={(series) => onChange({ chart: { ...spec, series: series ?? null } })} aria-label={t('split_by')} />
                </Field>
              ) : null}
              {spec.type === 'bar' || spec.type === 'area' || spec.type === 'line' || !spec.type ? (
                <Checkbox checked={Boolean(spec.stacked)} disabled={readOnly} onChange={(e) => onChange({ chart: { ...spec, stacked: e.target.checked } })}>
                  {t('stacked')}
                </Checkbox>
              ) : null}
              {spec.type === 'bar' || !spec.type ? (
                <Checkbox checked={Boolean(spec.horizontal)} disabled={readOnly} onChange={(e) => onChange({ chart: { ...spec, horizontal: e.target.checked } })}>
                  {t('horizontal')}
                </Checkbox>
              ) : null}
            </div>
          ) : (
            <div className="nb-chart-controls">
              <Field label={t('pivot_rows')}>
                <Select size="small" mode="multiple" style={{ minWidth: 170 }} value={spec.rows ?? []} disabled={readOnly || !columns.length}
                  maxTagCount="responsive" options={colOptions} onChange={(rows) => onChange({ chart: { ...spec, rows } })} aria-label={t('pivot_rows')} />
              </Field>
              <Field label={t('pivot_columns')}>
                <Select size="small" mode="multiple" style={{ minWidth: 150 }} value={spec.columns ?? []} disabled={readOnly || !columns.length}
                  maxTagCount="responsive" options={colOptions} onChange={(cols) => onChange({ chart: { ...spec, columns: cols } })} aria-label={t('pivot_columns')} />
              </Field>
              <Field label={t('pivot_values')}>
                <Select size="small" mode="multiple" style={{ minWidth: 170 }} value={spec.values ?? []} disabled={readOnly || !columns.length}
                  maxTagCount="responsive" placeholder={t('agg_count')} options={colOptions}
                  onChange={(values) => onChange({ chart: { ...spec, values } })} aria-label={t('pivot_values')} />
              </Field>
              <Field label={t('summarize')}>
                <Select size="small" style={{ width: 120 }} value={!spec.values?.length ? 'count' : spec.agg && spec.agg !== 'none' ? spec.agg : 'sum'} disabled={readOnly || !spec.values?.length}
                  options={AGGS.filter((k) => k !== 'none').map((k) => ({ value: k, label: t(`agg_${k}`) }))}
                  onChange={(agg) => onChange({ chart: { ...spec, agg } })} aria-label={t('summarize')} />
              </Field>
            </div>
          )}
          <ChartBody {...props} spec={spec} />
        </div>
      ) : null}

      {cell.type === 'sql' || cell.type === 'python' ? (
        <CellOutputView
          output={cell.output}
          images={props.liveImages}
          canChart={cell.type === 'sql' && Boolean(cell.name)}
          readOnly={readOnly}
          onAction={props.onOutputAction}
          onFix={props.aiAvailable && !readOnly && cell.output?.kind === 'error' && cell.output.text
            ? () => props.onAskAi(
              `The cell fails with the error below. Fix the code so it runs and still does what it was written to do; change as little as possible.\n\nError:\n${cell.output!.text!.slice(-3000)}`,
            )
            : undefined}
        />
      ) : null}
    </section>
  );
}

/** The chart, or a plain next step when there's nothing to draw yet. */
function ChartBody(props: Props & { spec: ChartSpec }) {
  const t = useTranslations('notebooks');
  const { spec, chartData, chartProducer, dark } = props;
  // Stable so the chart doesn't redraw on every keystroke elsewhere.
  const noteFn = React.useCallback((shown: number, total: number) => t('chart_top_of', { shown, total }), [t]);
  const noteTopFn = React.useCallback((shown: number, total: number) => t('chart_top_only', { shown, total }), [t]);
  // Summaries are only as complete as the rows the notebook holds; say so when a query was capped.
  const partial = chartData?.row_count && chartData.row_count > chartData.rows.length
    ? <Text type="secondary" className="nb-output-meta">{t('based_on_rows', { shown: chartData.rows.length, total: chartData.row_count })}</Text>
    : null;
  if (chartData && props.cell.type === 'pivot' && (spec.rows?.length || spec.columns?.length)) {
    return <>{partial}<PivotView spec={spec} columns={chartData.columns} rows={chartData.rows} fileName={spec.from ?? 'pivot'} /></>;
  }
  if (chartData && props.cell.type === 'chart' && spec.x && (spec.y?.length || defaultAgg(spec) === 'count')) {
    return (
      <>
      {partial}
      <NotebookChart
        spec={spec}
        columns={chartData.columns}
        rows={chartData.rows}
        dark={dark}
        ariaLabel={t('chart_alt', { from: spec.from ?? '' })}
        otherLabel={t('chart_other')}
        note={noteFn}
        noteTop={noteTopFn}
      />
      </>
    );
  }
  let text: string;
  let action: React.ReactNode = null;
  if (!spec.from) {
    text = props.results.length ? t('chart_pick_result') : t('chart_needs_result');
  } else if (!chartData) {
    if (chartProducer) {
      text = t('chart_not_run', { name: spec.from });
      action = (
        <Button size="small" icon={<CaretRightOutlined />} disabled={props.busy} onClick={() => props.onRunCell(chartProducer.id)}>
          {t('run_name', { name: spec.from })}
        </Button>
      );
    } else {
      text = t('chart_missing', { name: spec.from });
    }
  } else {
    text = props.cell.type === 'pivot' ? t('pivot_hint') : t('chart_hint');
  }
  return (
    <div className="nb-chart-empty">
      <Text type="secondary">{text}</Text>
      {action}
    </div>
  );
}
