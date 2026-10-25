'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, Checkbox, Drawer, Dropdown, Empty, Input, List, Modal, Segmented, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  BulbOutlined,
  ClearOutlined,
  ExperimentOutlined,
  FilterOutlined,
  FunctionOutlined,
  RobotOutlined,
  GroupOutlined,
  PlusOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  detectTypes,
  failedValues,
  previewSteps,
  profileSteps,
  stepParts,
  type PrepStep,
  type SampleMode,
  type TypeSpec,
  type ColumnMeaning,
  type CleaningLog,
  type Finding,
} from '@/api/prep';
import { appendStep, COLUMN_TYPES, friendlyType, moveStep, steps as build, type ColumnType } from './recipeSteps';
import { ColumnMeaningModal } from './ColumnMeaningModal';
import { stepSentence, toggleDisabled } from './stepText';
import { ColumnHeader } from './ColumnHeader';
import { StepList } from './StepList';
import { StepForm, formForStep, type FormKind } from './StepForm';
import { SqlView, YamlView } from './CodeViews';
import { CleanPanel, decisionKey, type AugmentAction } from './CleanPanel';
import { getDataSourceSchema } from '@/api/dataSources';
import { isEnterpriseEdition } from '@/utils/appPaths';
import { SidePanel } from '@/components/layout/SidePanel';
import './recipe-editor.css';

const { Text } = Typography;

export type RecipeEditorProps = {
  dataSourceId: string;
  table?: string | null;
  /** Preview a landed lake table (pipelines) instead of the live source. */
  lakeObjectId?: string | null;
  projectId?: string | null;
  steps: PrepStep[];
  onChange: (steps: PrepStep[]) => void;
  readOnly?: boolean;
  /** Column meaning (description, role, personal data); shown when the host can save it. */
  columnMeta?: Record<string, ColumnMeaning>;
  onColumnMetaChange?: (meta: Record<string, ColumnMeaning>) => Promise<void>;
  /** The table this recipe produced, for adding columns to the semantic model. */
  outputDataSourceId?: string | null;
  /** Names the cleaning report. */
  name?: string;
  /** The CLEAN panel's decisions and notes; saved when the host can. */
  cleaning?: CleaningLog;
  onCleaningChange?: (log: CleaningLog) => Promise<void>;
};

const PREVIEW_LIMIT = 200;
const SAMPLE_ROWS: Record<SampleMode, number> = { first: 1000, random: 10000, full: 100000 };

type FormState = { kind: FormKind; columns: string[]; editIndex?: number; detected?: TypeSpec } | null;

/**
 * Prepare's one editor: steps on the left, the data after the selected step in the middle,
 * the CLEAN panel (understand, fix, review, enrich, note) on the right. Every change shows what it did, can be edited, switched off
 * or undone. Used by the Prepare page, file upload and pipelines.
 */
export function RecipeEditor({
  dataSourceId,
  table,
  lakeObjectId,
  projectId,
  steps,
  onChange,
  readOnly = false,
  columnMeta,
  onColumnMetaChange,
  outputDataSourceId,
  name,
  cleaning,
  onCleaningChange,
}: RecipeEditorProps) {
  const [meaningFor, setMeaningFor] = useState<{ column: string; kind: string } | null>(null);
  const tr = useTranslations('column_roles');
  const t = useTranslations('prepare');
  const tt = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  const tRoot = useTranslations();
  const [selected, setSelected] = useState<number | null>(null);
  const [selCols, setSelCols] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>(null);
  const [view, setView] = useState<'steps' | 'yaml' | 'sql'>('steps');
  const [sampleMode, setSampleMode] = useState<SampleMode>('first');
  const [search, setSearch] = useState('');
  const [failures, setFailures] = useState<{ step: number; column: string } | null>(null);
  const [detectOpen, setDetectOpen] = useState(false);
  const [detectPick, setDetectPick] = useState<string[]>([]);
  // Everything detected starts ticked; people untick what they disagree with.
  const [detectPicked, setDetectPicked] = useState(false);
  const [history, setHistory] = useState<{ past: PrepStep[][]; future: PrepStep[][] }>({ past: [], future: [] });

  const sample = { sample_mode: sampleMode, sample_rows: SAMPLE_ROWS[sampleMode] };
  const upTo = selected === null ? null : selected;
  const visibleSteps = useMemo(() => (upTo === null ? steps : steps.slice(0, upTo + 1)), [steps, upTo]);
  const base = { data_source_id: dataSourceId, table, lake_object_id: lakeObjectId ?? null };

  const commit = useCallback(
    (next: PrepStep[]) => {
      setHistory((h) => ({ past: [...h.past.slice(-49), steps], future: [] }));
      onChange(next);
    },
    [onChange, steps],
  );
  const undo = useCallback(() => {
    const prev = history.past[history.past.length - 1];
    if (!prev) return;
    setHistory({ past: history.past.slice(0, -1), future: [...history.future, steps] });
    onChange(prev);
    setSelected(null);
  }, [history, onChange, steps]);
  const redo = useCallback(() => {
    const next = history.future[history.future.length - 1];
    if (!next) return;
    setHistory({ past: [...history.past, steps], future: history.future.slice(0, -1) });
    onChange(next);
    setSelected(null);
  }, [history, onChange, steps]);

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, undo, redo]);

  const preview = useQuery({
    queryKey: ['prep', 'preview', dataSourceId, table ?? null, lakeObjectId ?? null, projectId ?? null, sampleMode, JSON.stringify(visibleSteps)],
    queryFn: () => previewSteps({ ...base, steps: visibleSteps, limit: PREVIEW_LIMIT, ...sample }, projectId),
    placeholderData: (prev) => prev,
  });
  const fullStats = useQuery({
    queryKey: ['prep', 'stats', dataSourceId, table ?? null, lakeObjectId ?? null, projectId ?? null, sampleMode, JSON.stringify(steps)],
    queryFn: () => previewSteps({ ...base, steps, limit: 1, ...sample }, projectId),
    enabled: upTo !== null,
    staleTime: 30_000,
  });
  const profile = useQuery({
    queryKey: ['prep', 'profile', dataSourceId, table ?? null, lakeObjectId ?? null, projectId ?? null, sampleMode, JSON.stringify(visibleSteps)],
    queryFn: () => profileSteps({ ...base, steps: visibleSteps, ...sample }, projectId),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const detect = useQuery({
    queryKey: ['prep', 'detect', dataSourceId, table ?? null, lakeObjectId ?? null, projectId ?? null, sampleMode, JSON.stringify(visibleSteps)],
    queryFn: () => detectTypes({ ...base, steps: visibleSteps, ...sample }, projectId),
    enabled: detectOpen || form?.kind === 'type_date' || form?.kind === 'type_number',
    staleTime: 60_000,
  });
  // Other tables of this connection, for Merge and Append.
  const otherTables = useQuery({
    queryKey: ['prep', 'tables', dataSourceId],
    queryFn: () => getDataSourceSchema(dataSourceId, 'source'),
    enabled: form?.kind === 'merge' || form?.kind === 'append',
    staleTime: 300_000,
    select: (res) =>
      (res.schema?.tables ?? []).map((tb: { name: string; schema?: string }) =>
        tb.schema && !['public', 'main'].includes(tb.schema) ? `${tb.schema}.${tb.name}` : tb.name,
      ),
  });
  const failureList = useQuery({
    queryKey: ['prep', 'failures', dataSourceId, table ?? null, lakeObjectId ?? null, sampleMode, JSON.stringify(steps), failures?.step, failures?.column],
    queryFn: () => failedValues({ ...base, steps, ...sample, step: failures!.step, column: failures!.column }, projectId),
    enabled: Boolean(failures),
  });

  const stepErrors = preview.data?.step_errors ?? [];
  const errorAt = (i: number) => stepErrors.find((e) => e.step === i)?.message;
  const stats = (upTo === null ? preview.data?.step_stats : fullStats.data?.step_stats) ?? preview.data?.step_stats ?? [];
  const changes = preview.data?.changes;
  const columnNames = useMemo(() => (preview.data?.columns ?? []).map((c) => c.name), [preview.data?.columns]);
  const dists = profile.data?.distributions ?? {};

  /** Insert after the selected step (or at the end), like Power Query. */
  const add = (step: PrepStep) => {
    if (readOnly) return;
    if (selected !== null && selected < steps.length - 1) {
      commit([...steps.slice(0, selected + 1), step, ...steps.slice(selected + 1)]);
      setSelected(selected + 1);
      return;
    }
    commit(appendStep(steps, step));
    setSelected(null);
  };

  const replaceAt = (i: number, step: PrepStep) => commit(steps.map((s, idx) => (idx === i ? step : s)));
  const insertAt = selected === null ? steps.length : selected + 1;
  const runDraft = (step: PrepStep, editIndex?: number) => {
    const draft =
      editIndex !== undefined
        ? steps.map((s, idx) => (idx === editIndex ? step : s)).slice(0, editIndex + 1)
        : [...steps.slice(0, insertAt), step];
    return previewSteps({ ...base, steps: draft, limit: 50, ...sample }, projectId);
  };

  const target = (column: string) => (selCols.includes(column) && selCols.length > 1 ? selCols : [column]);
  const open = (kind: FormKind, columns: string[], detected?: TypeSpec) => setForm({ kind, columns, detected });

  const setType = (columns: string[], type: ColumnType) => {
    if (type === 'date' || type === 'datetime') {
      open('type_date', columns, detect.data?.columns?.[columns[0]] ?? { type, formats: [] });
      return;
    }
    if (type === 'number' || type === 'integer' || type === 'decimal') {
      open('type_number', columns, detect.data?.columns?.[columns[0]] ?? { type, locale: 'us' });
      return;
    }
    add(build.setType(columns, { type }));
  };

  const columnMenu = (column: string): MenuProps['items'] => {
    const cols = target(column);
    const many = cols.length > 1;
    return [
      ...(many ? [{ key: 'count', disabled: true, label: t('applies_to', { count: cols.length }) }, { type: 'divider' as const }] : []),
      ...(!many ? [{ key: 'rename', label: t('action_rename'), onClick: () => open('rename', [column]) }] : []),
      ...(!many && onColumnMetaChange
        ? [
            {
              key: 'meaning',
              label: t('action_meaning'),
              onClick: () => setMeaningFor({ column, kind: friendlyType((preview.data?.columns ?? []).find((c) => c.name === column)?.type ?? '') }),
            },
          ]
        : []),
      {
        key: 'type',
        label: t('action_change_type'),
        children: [
          ...COLUMN_TYPES.map((type) => ({ key: `type-${type}`, label: t(`type_${type}`), onClick: () => setType(cols, type) })),
          // Category is how a column is used, not how it is stored: it groups rows by its values.
          ...(onColumnMetaChange
            ? [
                { type: 'divider' as const },
                {
                  key: 'type-category',
                  label: <Tooltip title={tr('category_hint')} placement="right">{tr('use_as_category')}</Tooltip>,
                  onClick: () =>
                    void onColumnMetaChange({
                      ...(columnMeta ?? {}),
                      ...Object.fromEntries(cols.map((c) => [c, { ...(columnMeta?.[c] ?? {}), role: 'category' as const }])),
                    }),
                },
              ]
            : []),
        ],
      },
      {
        key: 'clean',
        label: t('group_clean'),
        children: [
          { key: 'trim', label: t('action_trim'), onClick: () => add(build.trim(cols)) },
          { key: 'empty', label: t('action_empty_markers'), onClick: () => add(build.emptyMarkers(cols)) },
          { key: 'case', label: t('action_case'), onClick: () => open('change_case', cols) },
          { key: 'currency', label: t('action_strip_currency'), onClick: () => add(build.stripCurrency(cols)) },
          { key: 'replace', label: t('action_replace'), onClick: () => open('replace', cols) },
          { key: 'fill', label: t('action_fill'), onClick: () => open('fill', cols) },
          { key: 'mask', label: t('action_mask'), onClick: () => open('mask', cols) },
        ],
      },
      ...(!many
        ? [
            {
              key: 'transform',
              label: t('group_transform'),
              children: [
                { key: 'split', label: t('action_split'), onClick: () => open('split', [column]) },
                { key: 'extract', label: t('action_extract'), onClick: () => open('extract', [column]) },
                { key: 'flatten', label: t('action_flatten_json'), onClick: () => open('flatten_json', [column]) },
                { key: 'explode', label: t('action_explode'), onClick: () => add(build.explode(column)) },
              ],
            },
          ]
        : [{ key: 'concat', label: t('action_concat'), onClick: () => open('concat', cols) }]),
      ...(isEnterpriseEdition()
        ? [{ key: 'ai_answer', icon: <ThunderboltOutlined />, label: t('action_ask_ai_values'), onClick: () => open('ai_answer', cols) }]
        : []),
      {
        key: 'rows',
        label: t('group_rows'),
        children: [
          { key: 'filter', label: t('action_filter'), onClick: () => open('filter_rows', cols) },
          { key: 'not_empty', label: t('action_remove_empty_rows'), onClick: () => add(build.removeEmptyRows(cols)) },
          { key: 'dedupe', label: t('action_dedupe_by'), onClick: () => add(build.dedupeBy(cols)) },
          ...(!many
            ? [
                { key: 'sort_asc', label: t('action_sort_asc'), onClick: () => add(build.sort(column, false)) },
                { key: 'sort_desc', label: t('action_sort_desc'), onClick: () => add(build.sort(column, true)) },
              ]
            : []),
        ],
      },
      { type: 'divider' },
      { key: 'keep', label: t('action_keep_only'), onClick: () => add(build.keepOnly(cols)) },
      {
        key: 'remove',
        danger: true,
        label: many ? t('action_remove_columns', { count: cols.length }) : t('action_remove_column'),
        onClick: () => add(build.remove(cols)),
      },
    ];
  };

  const addMenu: MenuProps['items'] = [
    { key: 'formula', icon: <FunctionOutlined />, label: t('add_formula'), onClick: () => open('formula', selCols) },
    { key: 'conditional', label: t('add_conditional'), onClick: () => open('conditional', selCols) },
    { key: 'concat', label: t('action_concat'), onClick: () => open('concat', selCols) },
  ];
  // A model's or the AI's answer as a new column (Enterprise: Models, AI Decisions).
  const aiMenu: MenuProps['items'] = [
    { key: 'ai_answer', icon: <ThunderboltOutlined />, label: t('add_ai_answer'), onClick: () => open('ai_answer', selCols) },
    { key: 'predict', icon: <ExperimentOutlined />, label: t('add_predict'), onClick: () => open('predict', selCols) },
  ];
  const tableMenu: MenuProps['items'] = [
    { key: 'checks', label: t('action_checks'), onClick: () => open('checks', selCols) },
    { key: 'merge', label: t('action_merge'), onClick: () => open('merge', selCols) },
    { key: 'append', label: t('action_append'), onClick: () => open('append', []) },
    { key: 'pivot', label: t('action_pivot'), onClick: () => open('pivot', selCols) },
    { type: 'divider' },
    { key: 'dedupe_rows', label: t('action_dedupe_rows'), onClick: () => add(build.dedupeRows()) },
    { key: 'rename_all', label: t('action_rename_all'), onClick: () => open('rename_all', []) },
    { key: 'group', label: t('action_group'), onClick: () => open('group', selCols) },
    { key: 'unpivot', label: t('action_unpivot'), onClick: () => open('unpivot', selCols) },
    { type: 'divider' },
    { key: 'sql', label: t('action_sql'), onClick: () => open('sql', []) },
  ];

  const editStep = (i: number) => {
    const kind = formForStep(steps[i]);
    if (!kind) {
      setView('yaml');
      return;
    }
    setForm({ kind, columns: [], editIndex: i });
  };

  const changed = changes?.changed ?? {};
  const added = new Set(changes?.added ?? []);
  const q = search.trim().toLowerCase();
  const rows = (preview.data?.rows ?? []).map((r, i) => ({ __i: i, ...r }));
  const filteredRows = q ? rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q))) : rows;

  const gridColumns = (preview.data?.columns ?? []).map((col) => ({
    key: col.name,
    dataIndex: col.name,
    ellipsis: true,
    width: 160,
    onHeaderCell: () => ({ 'data-col': col.name }) as React.HTMLAttributes<HTMLElement>,
    title: (
      <ColumnHeader
        name={col.name}
        engineType={col.type}
        dist={dists[col.name]}
        selected={selCols.includes(col.name)}
        isNew={added.has(col.name)}
        meaning={columnMeta?.[col.name]}
        readOnly={readOnly}
        menu={columnMenu(col.name)}
        onSelect={(additive) =>
          setSelCols((cur) =>
            additive
              ? cur.includes(col.name)
                ? cur.filter((c) => c !== col.name)
                : [...cur, col.name]
              : cur.length === 1 && cur[0] === col.name
                ? []
                : [col.name],
          )
        }
      />
    ),
    onCell: (row: { __i: number }) => ({
      className: [
        changed[col.name]?.includes(row.__i) ? 'recipe-editor__cell--changed' : '',
        added.has(col.name) ? 'recipe-editor__cell--added' : '',
        selCols.includes(col.name) ? 'recipe-editor__cell--selected' : '',
      ]
        .filter(Boolean)
        .join(' '),
    }),
    render: (value: unknown) =>
      value === null || value === undefined ? (
        <Text type="secondary" italic>
          {t('empty_cell')}
        </Text>
      ) : (
        String(typeof value === 'object' ? JSON.stringify(value) : value)
      ),
  }));

  const findings = profile.data?.findings ?? [];
  const removedCols = changes?.removed ?? [];
  const changedCount = Object.values(changed).reduce((n, list) => n + list.length, 0);
  const detected = Object.entries(detect.data?.columns ?? {});
  const picked = detectPicked ? detectPick : detected.map(([c]) => c);
  const pick = (cols: string[]) => {
    setDetectPicked(true);
    setDetectPick(cols);
  };
  const applyAll = () => {
    const fixes = findings.map((f) => f.suggested_step).filter(Boolean) as PrepStep[];
    if (!fixes.length) return;
    commit(fixes.reduce((acc, s) => appendStep(acc, s), steps));
    setSelected(null);
  };

  const healthTag = profile.data && profile.data.health != null ? (
    <Tag color={profile.data.health >= 80 ? 'success' : profile.data.health >= 50 ? 'warning' : 'error'}>
      {t('health', { score: profile.data.health })}
    </Tag>
  ) : null;
  const findingText = (f: Finding) =>
    tRoot(
      f.message_key as never,
      Object.fromEntries(
        Object.entries(f.params).map(([k, v]) => [
          k,
          k === 'type' ? t(`type_${String(v)}`).toLowerCase() : Array.isArray(v) ? v.join(' → ') : (v as never),
        ]),
      ) as never,
    );
  const openIssues =
    findings.filter((f) => f.suggested_step).length +
    findings.filter((f) => !f.suggested_step && !cleaning?.decisions?.[decisionKey(f)]).length;
  const augment: AugmentAction[] = [
    { key: 'formula', icon: <FunctionOutlined />, label: t('add_formula'), onClick: () => open('formula', selCols) },
    { key: 'conditional', label: t('add_conditional'), onClick: () => open('conditional', selCols) },
    { key: 'concat', label: t('action_concat'), onClick: () => open('concat', selCols) },
    { key: 'split', label: t('action_split'), needsColumn: true, onClick: () => open('split', selCols.slice(0, 1)) },
    { key: 'extract', label: t('action_extract'), needsColumn: true, onClick: () => open('extract', selCols.slice(0, 1)) },
    { key: 'merge', label: t('action_merge'), onClick: () => open('merge', selCols) },
    { key: 'append', label: t('action_append'), onClick: () => open('append', []) },
    { key: 'group', label: t('action_group'), onClick: () => open('group', selCols) },
    ...(isEnterpriseEdition()
      ? [
          { key: 'ai_answer', icon: <ThunderboltOutlined />, label: t('add_ai_answer'), onClick: () => open('ai_answer', selCols) },
          { key: 'predict', icon: <ExperimentOutlined />, label: t('add_predict'), onClick: () => open('predict', selCols) },
        ]
      : []),
  ];
  const showColumn = (column: string) => {
    setSelCols([column]);
    requestAnimationFrame(() => {
      const th = Array.from(document.querySelectorAll<HTMLElement>('.recipe-editor__grid th[data-col]')).find((el) => el.dataset.col === column);
      th?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  };

  return (
    <div className="recipe-editor">
      <StepList
        steps={steps}
        table={preview.data?.table ?? table ?? '…'}
        selected={selected}
        stats={stats}
        errorAt={errorAt}
        readOnly={readOnly}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onSelect={setSelected}
        onEdit={editStep}
        onToggle={(i) => replaceAt(i, toggleDisabled(steps[i]))}
        onMove={(i, d) => commit(moveStep(steps, i, d))}
        onRemove={(i) => {
          commit(steps.filter((_, idx) => idx !== i));
          setSelected(null);
        }}
        onUndo={undo}
        onRedo={redo}
        onShowFailures={(step, column) => setFailures({ step, column })}
      />

      <section className="recipe-editor__grid">
        <div className="recipe-editor__toolbar">
          {!readOnly ? (
            <Space wrap size={6}>
              <Dropdown menu={{ items: addMenu }} trigger={['click']}>
                <Button size="small" type="primary" icon={<PlusOutlined />}>
                  {t('add_column')}
                </Button>
              </Dropdown>
              <Button size="small" icon={<FilterOutlined />} onClick={() => open('filter_rows', selCols)}>
                {t('action_filter')}
              </Button>
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                onClick={() => {
                  setDetectPick([]);
                  setDetectPicked(false);
                  setDetectOpen(true);
                }}
              >
                {t('detect_types')}
              </Button>
              {isEnterpriseEdition() ? (
                <Dropdown menu={{ items: aiMenu }} trigger={['click']}>
                  <Button size="small" icon={<RobotOutlined />}>{t('ai_steps')}</Button>
                </Dropdown>
              ) : null}
              <Dropdown menu={{ items: tableMenu }} trigger={['click']}>
                <Button size="small" icon={<GroupOutlined />}>
                  {t('table_actions')}
                </Button>
              </Dropdown>
            </Space>
          ) : (
            <span />
          )}
          <Input
            size="small"
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t('search_rows')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 170 }}
            aria-label={t('search_rows')}
          />
        </div>

        {selCols.length > 1 && !readOnly ? (
          <div className="recipe-editor__selection">
            <Text strong>{t('selected_columns', { count: selCols.length })}</Text>
            <Dropdown menu={{ items: columnMenu(selCols[0]) }} trigger={['click']}>
              <Button size="small">{t('actions')}</Button>
            </Dropdown>
            <Button size="small" type="text" icon={<ClearOutlined />} onClick={() => setSelCols([])}>
              {t('clear_selection')}
            </Button>
          </div>
        ) : null}

        <div className="recipe-editor__grid-meta">
          <Text type="secondary">
            {preview.data
              ? t('preview_meta', {
                  rows: preview.data.rows.length,
                  columns: preview.data.columns.length,
                  sample: preview.data.sample_rows,
                  mode: t(`sample_label_${preview.data.sample_mode ?? 'first'}`),
                })
              : t('loading_preview')}
          </Text>
          {preview.data?.sampled ? <Tag color="gold">{t('sample_partial')}</Tag> : null}
          {selected !== null && selected >= 0 && changes ? (
            <Space size={4} wrap>
              <Text type="secondary">{t('this_step')}</Text>
              {changedCount ? <Tag color="blue">{t('cells_changed', { count: changedCount })}</Tag> : null}
              {changes.added.length ? <Tag color="green">{t('stat_added', { count: changes.added.length })}</Tag> : null}
              {removedCols.length ? (
                <Tooltip title={removedCols.join(', ')}>
                  <Tag>{t('stat_removed', { count: removedCols.length })}</Tag>
                </Tooltip>
              ) : null}
            </Space>
          ) : null}
          {preview.data?.quarantined_count ? (
            <Tag color="warning">{t('set_aside_count', { count: preview.data.quarantined_count })}</Tag>
          ) : null}
          <span className="recipe-editor__spacer" />
          <Space wrap size={6} className="recipe-editor__views">
            <Tooltip title={t('sample_hint')}>
              <Segmented
                size="small"
                value={sampleMode}
                onChange={(v) => setSampleMode(v as SampleMode)}
                options={[
                  { value: 'first', label: t('sample_first') },
                  { value: 'random', label: t('sample_random') },
                  { value: 'full', label: t('sample_full') },
                ]}
              />
            </Tooltip>
            <Segmented
              size="small"
              value={view}
              onChange={(v) => setView(v as 'steps' | 'yaml' | 'sql')}
              options={[
                { value: 'steps', label: t('view_data') },
                { value: 'yaml', label: t('view_yaml') },
                { value: 'sql', label: t('view_sql') },
              ]}
            />
          </Space>
        </div>

        {view === 'yaml' ? (
          <YamlView
            key={JSON.stringify(steps)}
            steps={steps}
            readOnly={readOnly}
            onApply={(next) => {
              commit(next);
              setSelected(null);
              setView('steps');
            }}
          />
        ) : view === 'sql' ? (
          <SqlView
            sql={preview.data?.sql ?? null}
            readOnly={readOnly}
            onAddSqlStep={(query) => {
              add({ sql: { query } });
              setView('steps');
            }}
          />
        ) : (
          <>
            {stepErrors.length > 0 ? (
              <Alert
                type="error"
                showIcon
                message={t('step_failed', { step: stepErrors[0].step + 1 })}
                description={stepErrors[0].message}
                style={{ marginBottom: 8 }}
              />
            ) : null}
            <Table
              size="small"
              rowKey="__i"
              columns={gridColumns}
              dataSource={filteredRows}
              loading={preview.isFetching}
              pagination={{ pageSize: 100, showSizeChanger: false, size: 'small' }}
              scroll={{ x: 'max-content', y: 'calc(100dvh - 310px)' }}
              locale={{ emptyText: preview.isError ? t('preview_error') : <Empty description={t('no_rows')} /> }}
            />
          </>
        )}
      </section>

      {/* Starts folded on narrow screens, where the grid needs the width; a click away. */}
      <SidePanel
        id="prepare.clean"
        side="right"
        title={t('clean.title')}
        icon={<BulbOutlined />}
        count={openIssues}
        width={300}
        defaultCollapsed={() => typeof window !== 'undefined' && window.innerWidth < 1280}
        className="recipe-editor__suggest"
        extra={healthTag}
      >
        <CleanPanel
          name={name ?? table ?? ''}
          table={preview.data?.table ?? table ?? ''}
          rowCount={profile.data?.profile?.row_count}
          sampled={profile.data?.profile?.sampled}
          columns={preview.data?.columns ?? []}
          dists={dists}
          findings={findings}
          loading={profile.isFetching}
          error={profile.data?.error}
          readOnly={readOnly}
          columnMeta={columnMeta}
          cleaning={cleaning}
          onCleaningChange={readOnly ? undefined : onCleaningChange}
          stepSentences={steps.map((step) => stepSentence(step, tt))}
          findingText={findingText}
          augment={augment}
          hasSelection={selCols.length > 0}
          onApply={(step) => add(step)}
          onApplyAll={applyAll}
          onSelectColumn={showColumn}
          onMeaning={
            onColumnMetaChange
              ? (column) => setMeaningFor({ column, kind: friendlyType((preview.data?.columns ?? []).find((c) => c.name === column)?.type ?? '') })
              : undefined
          }
          onExclude={(column) => open('filter_rows', [column])}
        />
      </SidePanel>

      {form ? (
        <StepForm
          key={`${form.kind}-${form.editIndex ?? 'new'}`}
          open
          kind={form.kind}
          columns={columnNames}
          selected={form.columns}
          existing={form.editIndex !== undefined ? steps[form.editIndex] : undefined}
          detected={form.detected ?? (form.columns[0] ? detect.data?.columns?.[form.columns[0]] : undefined)}
          tables={otherTables.data ?? []}
          before={preview.data?.rows ?? []}
          runDraft={(step) => runDraft(step, form.editIndex)}
          onCancel={() => setForm(null)}
          onSubmit={(step) => {
            if (form.editIndex !== undefined) replaceAt(form.editIndex, step);
            else add(step);
            setForm(null);
          }}
        />
      ) : null}

      <Modal
        open={detectOpen}
        title={t('detect_types')}
        onCancel={() => setDetectOpen(false)}
        okText={t('apply_types', { count: picked.length })}
        okButtonProps={{ disabled: picked.length === 0 }}
        onOk={() => {
          const columns = Object.fromEntries(
            detected
              .filter(([c]) => picked.includes(c))
              .map(([c, spec]) => [
                c,
                Object.fromEntries(Object.entries(spec).filter(([k]) => !['coverage', 'ambiguous', 'failing'].includes(k))),
              ]),
          );
          add({ set_types: { columns } });
          setDetectOpen(false);
        }}
        width={720}
      >
        {detect.isFetching ? <Text type="secondary">{t('checking_data')}</Text> : null}
        {!detect.isFetching && detected.length === 0 ? <Text type="secondary">{t('detect_nothing')}</Text> : null}
        {detected.length ? (
          <>
            <Table
              size="small"
              pagination={false}
              rowKey={(r) => r[0]}
              dataSource={detected}
              rowSelection={{ selectedRowKeys: picked, onChange: (keys) => pick(keys as string[]) }}
              columns={[
                { title: t('field_column'), render: (_, r) => r[0] },
                {
                  title: t('detected_as'),
                  render: (_, r) => (
                    <Space direction="vertical" size={0}>
                      <Text>{t(`type_${r[1].type}`)}</Text>
                      {r[1].formats?.length ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {r[1].formats.join(' · ')}
                        </Text>
                      ) : null}
                      {r[1].ambiguous ? <Tag color="gold">{t('date_ambiguous_short')}</Tag> : null}
                    </Space>
                  ),
                },
                { title: t('readable'), render: (_, r) => `${Math.round((r[1].coverage ?? 1) * 100)}%` },
                {
                  title: t('not_readable'),
                  render: (_, r) => (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {(r[1].failing ?? []).join(' · ') || '—'}
                    </Text>
                  ),
                },
              ]}
            />
            <Checkbox
              style={{ marginTop: 8 }}
              checked={picked.length === detected.length}
              onChange={(e) => pick(e.target.checked ? detected.map(([c]) => c) : [])}
            >
              {t('select_all')}
            </Checkbox>
          </>
        ) : null}
      </Modal>

      <Drawer
        open={Boolean(failures)}
        onClose={() => setFailures(null)}
        title={failures ? t('failures_title', { column: failures.column }) : ''}
        width={420}
      >
        {failures && steps[failures.step] ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text type="secondary">{t('failures_hint', { step: stepSentence(steps[failures.step], tt) })}</Text>
            <List
              loading={failureList.isLoading}
              dataSource={failureList.data?.values ?? []}
              renderItem={(v) => (
                <List.Item extra={<Tag>{v.count}</Tag>}>
                  <Text code>{v.value}</Text>
                </List.Item>
              )}
            />
            {!readOnly && formForStep(steps[failures.step]) ? (
              <Button
                type="primary"
                onClick={() => {
                  const i = failures.step;
                  setFailures(null);
                  editStep(i);
                }}
              >
                {t('edit_step')}
              </Button>
            ) : null}
          </Space>
        ) : null}
      </Drawer>
      {onColumnMetaChange && meaningFor ? (
        <ColumnMeaningModal
          open
          column={meaningFor.column}
          kind={meaningFor.kind}
          value={columnMeta?.[meaningFor.column]}
          outputDataSourceId={outputDataSourceId}
          onClose={() => setMeaningFor(null)}
          onSave={(meaning) => onColumnMetaChange({ ...(columnMeta ?? {}), [meaningFor.column]: meaning })}
        />
      ) : null}
    </div>
  );
}

export default RecipeEditor;

/** Kind of a step, for callers that store recipes elsewhere (pipelines). */
export const kindOf = (step: PrepStep) => stepParts(step)[0];
