'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Checkbox, Input, InputNumber, Modal, Radio, Select, Space, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { datePatterns, stepParts, type PrepStep, type PreviewResult, type TypeSpec } from '@/api/prep';
import { ConditionBuilder, conditionsComplete, type Condition } from './ConditionBuilder';
import { FormulaEditor } from './FormulaEditor';
import { convertName, renameAllMapping, stepColumns, steps as build, type Convention } from './recipeSteps';
import { fetchApi } from '@/utils/api';
import { useProjectStore } from '@/stores/useProjectStore';

const { Text } = Typography;

export type FormKind =
  | 'rename'
  | 'rename_all'
  | 'type_date'
  | 'type_number'
  | 'replace'
  | 'fill'
  | 'split'
  | 'extract'
  | 'mask'
  | 'change_case'
  | 'filter_rows'
  | 'conditional'
  | 'formula'
  | 'concat'
  | 'flatten_json'
  | 'dedupe'
  | 'group'
  | 'unpivot'
  | 'checks'
  | 'pivot'
  | 'merge'
  | 'append'
  | 'sql'
  | 'predict'
  | 'ai_answer';

/** Which form edits an existing step (others are edited as code). */
export function formForStep(step: PrepStep): FormKind | null {
  const [kind, a] = stepParts(step);
  if (kind === 'set_types') {
    const specs = Object.values((a.columns as Record<string, TypeSpec>) ?? {});
    if (specs.length && specs.every((s) => s.type === 'date' || s.type === 'datetime')) return 'type_date';
    if (specs.length && specs.every((s) => s.type === 'number' || s.type === 'integer' || s.type === 'decimal')) return 'type_number';
    return null;
  }
  const map: Record<string, FormKind> = {
    rename: 'rename_all', replace: 'replace', fill: 'fill', split: 'split', extract: 'extract', mask: 'mask',
    change_case: 'change_case', filter_rows: 'filter_rows', conditional: 'conditional', formula: 'formula',
    concat: 'concat', flatten_json: 'flatten_json', dedupe: 'dedupe', aggregate: 'group', unpivot: 'unpivot',
    validate: 'checks', pivot: 'pivot', join: 'merge', union: 'append', sql: 'sql',
    predict: 'predict', ai_answer: 'ai_answer',
  };
  return map[kind] ?? null;
}

type Values = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function initialValues(kind: FormKind, columns: string[], selected: string[], existing?: PrepStep, detected?: TypeSpec): Values {
  const a = existing ? stepParts(existing)[1] : {};
  const cols = (a.columns as string[] | undefined) ?? selected;
  switch (kind) {
    case 'rename':
      return { column: selected[0], to: selected[0] };
    case 'rename_all':
      return { convention: 'snake', mapping: (a.columns as Record<string, string>) ?? null };
    case 'type_date': {
      const spec = existing ? Object.values((a.columns as Record<string, TypeSpec>) ?? {})[0] : detected;
      return {
        columns: existing ? Object.keys((a.columns as object) ?? {}) : selected,
        formats: spec?.formats ?? [],
        withTime: spec?.type === 'datetime',
        excel: Boolean(spec?.excel_serial),
        example: '',
      };
    }
    case 'type_number': {
      const spec = existing ? Object.values((a.columns as Record<string, TypeSpec>) ?? {})[0] : detected;
      return { columns: existing ? Object.keys((a.columns as object) ?? {}) : selected, locale: spec?.locale ?? 'us', type: spec?.type ?? 'number' };
    }
    case 'replace': {
      const pairs = Object.entries((a.mapping as Record<string, string>) ?? {});
      if (a.find) pairs.unshift([String(a.find), String(a.replace_with ?? '')]);
      return { columns: cols, pairs: pairs.length ? pairs : [['', '']], match: a.match ?? (a.regex ? 'regex' : 'contains'), caseSensitive: a.case_sensitive ?? false };
    }
    case 'fill':
      return { columns: cols, strategy: a.strategy ?? 'value', value: a.value ?? '' };
    case 'split':
      return {
        column: (a.column as string) ?? selected[0], mode: a.mode ?? 'whitespace', delimiter: a.delimiter ?? ',',
        positions: ((a.positions as number[]) ?? []).join(', '), into: ((a.into as string[]) ?? []).join(', '), parts: a.parts ?? 2,
        keep: Boolean(a.keep_original),
      };
    case 'extract':
      return { column: (a.column as string) ?? selected[0], pattern: a.pattern ?? '(\\d+)', into: a.into ?? `${selected[0] ?? 'value'}_part`, group: a.group_index ?? 1 };
    case 'mask':
      return { columns: cols, method: a.method ?? 'hash' };
    case 'change_case':
      return { columns: cols, case: a.case ?? 'title' };
    case 'filter_rows':
      return {
        conditions: (a.conditions as Condition[]) ?? [{ column: selected[0] ?? columns[0] ?? '', op: 'equals', value: '' }],
        match: a.match ?? 'all', action: a.action ?? 'keep',
      };
    case 'conditional':
      return {
        into: a.into ?? 'category',
        rules: (a.rules as unknown[]) ?? [{ conditions: [{ column: selected[0] ?? columns[0] ?? '', op: 'gt', value: '' }], match: 'all', then: { value: '' } }],
        otherwise: a.otherwise ?? { value: '' },
      };
    case 'formula':
      return { into: a.into ?? 'new_column', expression: a.expression ?? '', language: a.language ?? 'excel' };
    case 'concat':
      return { columns: cols.length >= 2 ? cols : [], into: a.into ?? 'combined', separator: a.separator ?? ' ' };
    case 'sql':
      return { query: (a.query as string) ?? 'SELECT *\nFROM {input}' };
    case 'flatten_json':
      return { column: (a.column as string) ?? selected[0], fields: Object.keys((a.fields as object) ?? {}).join(', ') };
    case 'dedupe':
      return { columns: (a.keys as string[]) ?? selected };
    case 'group':
      return { by: (a.by as string[]) ?? selected, sum: a.sum ?? [], count: a.count ?? [], avg: a.avg ?? [], min: a.min ?? [], max: a.max ?? [] };
    case 'unpivot':
      return { columns: cols, name: a.name_column ?? 'attribute', value: a.value_column ?? 'value' };
    case 'checks': {
      const accepted = Object.entries((a.accepted_values as Record<string, string[]>) ?? {})[0];
      const range = Object.entries((a.range as Record<string, unknown[]>) ?? {})[0];
      return {
        notNull: (a.not_null as string[]) ?? selected, unique: (a.unique as string[]) ?? [],
        acceptedColumn: accepted?.[0], acceptedValues: (accepted?.[1] ?? []).join(', '),
        rangeColumn: range?.[0], rangeMin: range?.[1]?.[0] ?? '', rangeMax: range?.[1]?.[1] ?? '',
        onFail: a.on_fail ?? 'quarantine',
      };
    }
    case 'pivot':
      return { on: a.on ?? selected[0], using: a.using, agg: a.agg ?? 'sum', groupBy: (a.group_by as string[]) ?? [] };
    case 'merge': {
      const pairs = Object.entries((a.on as Record<string, string>) ?? {});
      return { asset: a.asset, how: a.how ?? 'left', pairs: pairs.length ? pairs : [[selected[0] ?? '', '']] };
    }
    case 'append':
      return { asset: a.asset, all: a.all ?? true };
    case 'predict':
      return { model_id: a.model_id, into: a.into ?? '' };
    case 'ai_answer':
      return { decision_id: a.decision_id, columns: cols, into: a.into ?? '' };
  }
}

const listOf = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean);

function buildStep(kind: FormKind, v: Values, columns: string[]): PrepStep | null {
  switch (kind) {
    case 'rename':
      return v.to && v.to !== v.column ? build.rename(v.column, v.to.trim()) : null;
    case 'rename_all': {
      const mapping = v.mapping ?? renameAllMapping(columns, v.convention as Convention);
      return mapping && Object.keys(mapping).length ? build.renameMany(mapping) : null;
    }
    case 'type_date':
      return v.columns?.length && (v.formats.length || v.excel)
        ? { set_types: { columns: Object.fromEntries(v.columns.map((c: string) => [c, { type: v.withTime ? 'datetime' : 'date', formats: v.formats, ...(v.excel ? { excel_serial: true } : {}) }])) } }
        : null;
    case 'type_number':
      return v.columns?.length ? { set_types: { columns: Object.fromEntries(v.columns.map((c: string) => [c, { type: v.type, locale: v.locale }])) } } : null;
    case 'replace': {
      const pairs = Object.fromEntries((v.pairs as string[][]).filter(([f]) => f !== ''));
      return v.columns?.length && Object.keys(pairs).length ? build.replace(v.columns, pairs, v.match, v.caseSensitive) : null;
    }
    case 'fill': {
      if (!v.columns?.length) return null;
      const raw = String(v.value ?? '');
      const num = Number(raw);
      return build.fill(v.columns, v.strategy, v.strategy === 'value' ? (raw !== '' && Number.isFinite(num) ? num : raw) : undefined);
    }
    case 'split': {
      if (!v.column) return null;
      const positions = listOf(String(v.positions)).map(Number).filter((n) => Number.isFinite(n) && n > 0);
      if (v.mode === 'positions' && !positions.length) return null;
      return build.split(v.column, {
        mode: v.mode, delimiter: v.mode === 'delimiter' || v.mode === 'rows' ? v.delimiter : undefined,
        positions: v.mode === 'positions' ? positions : undefined, into: listOf(String(v.into)), parts: Number(v.parts) || 2,
        ...(v.keep ? { keep_original: true } : {}),
      } as never);
    }
    case 'extract':
      return v.column && v.pattern && v.into ? build.extract(v.column, v.pattern, v.into.trim(), Number(v.group) || 0) : null;
    case 'mask':
      return v.columns?.length ? build.mask(v.columns, v.method) : null;
    case 'change_case':
      return v.columns?.length ? build.changeCase(v.columns, v.case) : null;
    case 'filter_rows':
      return conditionsComplete(v.conditions) ? { filter_rows: { conditions: v.conditions, match: v.match, action: v.action } } : null;
    case 'conditional': {
      const rules = (v.rules as { conditions: Condition[] }[]);
      if (!v.into || !rules.length || !rules.every((r) => conditionsComplete(r.conditions))) return null;
      return { conditional: { into: v.into.trim(), rules, otherwise: v.otherwise, ...(columns.includes(v.into.trim()) ? { replace: true } : {}) } };
    }
    case 'formula':
      return v.into && v.expression.trim() ? build.formula(v.into.trim(), v.expression, v.language, columns.includes(v.into.trim())) : null;
    case 'concat':
      return v.columns?.length >= 2 && v.into ? build.concat(v.columns, v.into.trim(), v.separator) : null;
    case 'sql': {
      // One statement over the previous step's result, which the engine names {input}.
      const query = String(v.query ?? '').trim().replace(/;\s*$/, '');
      return query.includes('{input}') && !query.includes(';') ? { sql: { query } } : null;
    }
    case 'flatten_json': {
      const fields = Object.fromEntries(listOf(String(v.fields)).map((f) => [f.replace(/[^A-Za-z0-9_]/g, '_'), `$.${f}`]));
      return v.column && Object.keys(fields).length ? build.flattenJson(v.column, fields) : null;
    }
    case 'dedupe':
      return v.columns?.length ? build.dedupeBy(v.columns) : build.dedupeRows();
    case 'group': {
      const measures = ['sum', 'count', 'avg', 'min', 'max'].reduce((acc, k) => (v[k]?.length ? { ...acc, [k]: v[k] } : acc), {});
      return Object.keys(measures).length ? { aggregate: { by: v.by ?? [], ...measures } } : null;
    }
    case 'unpivot':
      return v.columns?.length ? { unpivot: { columns: v.columns, name_column: v.name || 'attribute', value_column: v.value || 'value' } } : null;
    case 'checks': {
      const rules: Record<string, unknown> = {};
      if (v.notNull?.length) rules.not_null = v.notNull;
      if (v.unique?.length) rules.unique = v.unique;
      if (v.acceptedColumn && listOf(String(v.acceptedValues)).length) rules.accepted_values = { [v.acceptedColumn]: listOf(String(v.acceptedValues)) };
      if (v.rangeColumn && String(v.rangeMin) !== '' && String(v.rangeMax) !== '') {
        rules.range = { [v.rangeColumn]: [Number(v.rangeMin), Number(v.rangeMax)] };
      }
      return Object.keys(rules).length ? { validate: { ...rules, on_fail: v.onFail } } : null;
    }
    case 'pivot':
      return v.on && v.using ? { pivot: { on: v.on, using: v.using, agg: v.agg, ...(v.groupBy?.length ? { group_by: v.groupBy } : {}) } } : null;
    case 'merge': {
      const on = Object.fromEntries((v.pairs as string[][]).filter(([l, r]) => l && r));
      return v.asset && Object.keys(on).length ? { join: { asset: v.asset, how: v.how, on } } : null;
    }
    case 'append':
      return v.asset ? { union: { asset: v.asset, all: v.all } } : null;
    case 'predict':
      return v.model_id ? { predict: { model_id: v.model_id, ...(String(v.into ?? '').trim() ? { into: v.into.trim() } : {}) } } : null;
    case 'ai_answer':
      return v.decision_id && v.columns?.length
        ? { ai_answer: { decision_id: v.decision_id, columns: v.columns, ...(String(v.into ?? '').trim() ? { into: v.into.trim() } : {}) } }
        : null;
  }
}

type AiChoice = { value: string; label: string; ready: boolean };

/** Approved prediction models, or AI decisions, the recipe's project can use. */
function useAiChoices(kind: FormKind): AiChoice[] | null {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [choices, setChoices] = useState<AiChoice[] | null>(null);
  useEffect(() => {
    if (kind !== 'predict' && kind !== 'ai_answer') return;
    const qs = projectId ? `?project_id=${encodeURIComponent(String(projectId))}` : '';
    const load = kind === 'predict'
      ? fetchApi<{ items?: { id: string; name: string; task: string; production?: unknown }[] }>(`/api/models${qs}`)
          .then((r) => (r.items ?? []).filter((m) => m.task !== 'forecast').map((m) => ({ value: m.id, label: m.name, ready: Boolean(m.production) })))
      : fetchApi<{ definitions?: { id: string; name: string }[] }>(`/api/ai-decisions/definitions${qs}`)
          .then((r) => (r.definitions ?? []).map((d) => ({ value: d.id, label: d.name, ready: true })));
    load.then(setChoices).catch(() => setChoices([]));
  }, [kind, projectId]);
  return choices;
}

/** Patterns people reach for most, so Extract doesn't start from a blank regex. */
const EXTRACT_PRESETS = [
  { key: 'first_number', pattern: '(\\d+)', group: 1 },
  { key: 'decimal_number', pattern: '(-?\\d+(?:[.,]\\d+)?)', group: 1 },
  { key: 'letters', pattern: '([A-Za-z]+)', group: 1 },
  { key: 'in_brackets', pattern: '\\(([^)]*)\\)', group: 1 },
  { key: 'email_domain', pattern: '@([^\\s>]+)', group: 1 },
  { key: 'year', pattern: '((?:19|20)\\d{2})', group: 1 },
];

const DATE_FORMAT_CHOICES = ['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y', '%d %b %Y', '%d-%b-%Y', '%b %d, %Y', '%d.%m.%Y', '%Y/%m/%d', '%Y-%m-%d %H:%M:%S'];

export function StepForm({
  kind,
  open,
  columns,
  selected,
  existing,
  detected,
  tables = [],
  before,
  runDraft,
  onSubmit,
  onCancel,
}: {
  kind: FormKind;
  open: boolean;
  columns: string[];
  selected: string[];
  existing?: PrepStep;
  detected?: TypeSpec;
  /** Other tables of the same connection (Merge / Append). */
  tables?: string[];
  /** Rows shown in the grid right now (before the new step). */
  before: Record<string, unknown>[];
  /** Preview of the recipe with this step in place. */
  runDraft: (step: PrepStep) => Promise<PreviewResult>;
  onSubmit: (step: PrepStep) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('prepare');
  const [v, setV] = useState<Values>(() => initialValues(kind, columns, selected, existing, detected));
  const [draftState, setDraft] = useState<PreviewResult | null>(null);
  const [draftErrorState, setDraftError] = useState<string | null>(null);
  const [formulaOk, setFormulaOk] = useState(true);
  const set = (patch: Values) => setV((cur) => ({ ...cur, ...patch }));
  const aiChoices = useAiChoices(kind);
  const step = useMemo(() => buildStep(kind, v, columns), [kind, v, columns]);
  const ready = Boolean(step) && (kind !== 'formula' || formulaOk);

  useEffect(() => {
    if (!step || (kind === 'formula' && !formulaOk)) return;
    const handle = setTimeout(async () => {
      try {
        const res = await runDraft(step);
        setDraft(res);
        setDraftError(res.step_errors[0]?.message ?? null);
      } catch (err) {
        setDraftError(err instanceof Error ? err.message : String(err));
      }
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(step), formulaOk]);

  const multi = (field: string, label: string, min = 1) => (
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Text strong>{label}</Text>
      <Select
        mode="multiple"
        value={v[field]}
        onChange={(val) => set({ [field]: val })}
        options={columns.map((c) => ({ value: c, label: c }))}
        style={{ width: '100%' }}
        aria-label={label}
        status={(v[field]?.length ?? 0) < min ? 'warning' : undefined}
      />
    </Space>
  );
  const single = (field: string, label: string) => (
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Text strong>{label}</Text>
      <Select showSearch value={v[field]} onChange={(val) => set({ [field]: val })} options={columns.map((c) => ({ value: c, label: c }))} style={{ width: '100%' }} aria-label={label} />
    </Space>
  );
  const text = (field: string, label: string, placeholder?: string, extra?: string) => (
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Text strong>{label}</Text>
      <Input value={v[field]} placeholder={placeholder} onChange={(e) => set({ [field]: e.target.value })} aria-label={label} />
      {extra ? <Text type="secondary" style={{ fontSize: 12 }}>{extra}</Text> : null}
    </Space>
  );

  const addFromExample = async () => {
    const found = await datePatterns(v.example);
    if (found.length) set({ formats: Array.from(new Set([...v.formats, found[0]])), example: '' });
    else set({ exampleMiss: true });
  };

  const body = (() => {
    switch (kind) {
      case 'rename':
        return text('to', t('field_new_name'));
      case 'rename_all': {
        const mapping = v.mapping ?? renameAllMapping(columns, v.convention);
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {v.mapping ? null : (
              <Radio.Group value={v.convention} onChange={(e) => set({ convention: e.target.value })}>
                {(['snake', 'title', 'camel', 'lower', 'upper'] as Convention[]).map((c) => (
                  <Radio.Button key={c} value={c}>{convertName('Student ID', c)}</Radio.Button>
                ))}
              </Radio.Group>
            )}
            {mapping === null ? <Alert type="warning" showIcon message={t('rename_collision')} /> : null}
            <Table
              size="small"
              pagination={false}
              rowKey="from"
              scroll={{ y: 260 }}
              dataSource={Object.entries(mapping ?? {}).map(([from, to]) => ({ from, to }))}
              columns={[
                { title: t('col_before'), dataIndex: 'from' },
                {
                  title: t('col_after'),
                  dataIndex: 'to',
                  render: (to: string, row: { from: string }) => (
                    <Input size="small" value={to} onChange={(e) => set({ mapping: { ...(mapping ?? {}), [row.from]: e.target.value } })} aria-label={row.from} />
                  ),
                },
              ]}
              locale={{ emptyText: t('rename_nothing') }}
            />
          </Space>
        );
      }
      case 'type_date':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('columns', t('field_columns'))}
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text strong>{t('field_date_formats')}</Text>
              <Select
                mode="tags"
                value={v.formats}
                onChange={(val) => set({ formats: val })}
                options={DATE_FORMAT_CHOICES.map((f) => ({ value: f, label: f }))}
                style={{ width: '100%' }}
                placeholder="%d-%b-%Y"
                aria-label={t('field_date_formats')}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>{t('field_date_formats_hint')}</Text>
            </Space>
            <Space.Compact style={{ width: '100%' }}>
              <Input value={v.example} onChange={(e) => set({ example: e.target.value, exampleMiss: false })} placeholder={t('date_example_placeholder')} aria-label={t('date_example')} onPressEnter={() => void addFromExample()} />
              <Button onClick={() => void addFromExample()} disabled={!v.example?.trim()}>{t('date_example_add')}</Button>
            </Space.Compact>
            {v.exampleMiss ? <Text type="warning">{t('date_example_miss')}</Text> : null}
            {detected?.ambiguous ? <Alert type="info" showIcon message={t('date_ambiguous')} /> : null}
            <Checkbox checked={v.withTime} onChange={(e) => set({ withTime: e.target.checked })}>{t('date_with_time')}</Checkbox>
            <Checkbox checked={v.excel} onChange={(e) => set({ excel: e.target.checked })}>{t('date_excel_serial')}</Checkbox>
          </Space>
        );
      case 'type_number':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('columns', t('field_columns'))}
            <Radio.Group value={v.type} onChange={(e) => set({ type: e.target.value })}>
              <Radio value="number">{t('type_number')}</Radio>
              <Radio value="integer">{t('type_integer')}</Radio>
              <Radio value="decimal">{t('type_decimal')}</Radio>
            </Radio.Group>
            <Radio.Group value={v.locale} onChange={(e) => set({ locale: e.target.value })}>
              <Radio value="us">{t('locale_us')}</Radio>
              <Radio value="eu">{t('locale_eu')}</Radio>
            </Radio.Group>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('number_hint')}</Text>
          </Space>
        );
      case 'replace':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('columns', t('field_columns'))}
            <Radio.Group value={v.match} onChange={(e) => set({ match: e.target.value })}>
              <Radio.Button value="contains">{t('match_contains')}</Radio.Button>
              <Radio.Button value="whole">{t('match_whole')}</Radio.Button>
              <Radio.Button value="regex">{t('match_regex')}</Radio.Button>
            </Radio.Group>
            {(v.pairs as string[][]).map(([find, rep], i) => (
              <Space key={i} style={{ width: '100%' }}>
                <Input value={find} placeholder={v.match === 'regex' ? '\\s+' : t('field_find')} onChange={(e) => set({ pairs: v.pairs.map((p: string[], j: number) => (j === i ? [e.target.value, p[1]] : p)) })} aria-label={t('field_find')} />
                <Text type="secondary">→</Text>
                <Input value={rep} placeholder={t('field_replace_with')} onChange={(e) => set({ pairs: v.pairs.map((p: string[], j: number) => (j === i ? [p[0], e.target.value] : p)) })} aria-label={t('field_replace_with')} />
                <Button type="text" icon={<DeleteOutlined />} aria-label={t('remove_pair')} disabled={v.pairs.length === 1} onClick={() => set({ pairs: v.pairs.filter((_: unknown, j: number) => j !== i) })} />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />} onClick={() => set({ pairs: [...v.pairs, ['', '']] })}>{t('add_pair')}</Button>
            <Checkbox checked={v.caseSensitive} onChange={(e) => set({ caseSensitive: e.target.checked })}>{t('match_case')}</Checkbox>
          </Space>
        );
      case 'fill':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('columns', t('field_columns'))}
            <Radio.Group value={v.strategy} onChange={(e) => set({ strategy: e.target.value })}>
              {['value', 'down', 'up', 'mean', 'median', 'mode'].map((s) => (
                <Radio.Button key={s} value={s}>{t(`fill_${s}`)}</Radio.Button>
              ))}
            </Radio.Group>
            {v.strategy === 'value' ? text('value', t('field_fill_value'), '0', t('field_fill_value_hint')) : null}
          </Space>
        );
      case 'split':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {single('column', t('field_column'))}
            <Radio.Group value={v.mode} onChange={(e) => set({ mode: e.target.value })}>
              <Radio.Button value="whitespace">{t('split_whitespace')}</Radio.Button>
              <Radio.Button value="delimiter">{t('split_delimiter')}</Radio.Button>
              <Radio.Button value="positions">{t('split_positions')}</Radio.Button>
              <Radio.Button value="rows">{t('split_rows')}</Radio.Button>
            </Radio.Group>
            {v.mode === 'delimiter' || v.mode === 'rows' ? (
              <Space wrap>
                {[',', ';', '-', '/', '|', ' '].map((d) => (
                  <Tag.CheckableTag key={d} checked={v.delimiter === d} onChange={() => set({ delimiter: d })}>
                    {d === ' ' ? t('delimiter_space') : d}
                  </Tag.CheckableTag>
                ))}
                <Input size="small" style={{ width: 120 }} value={v.delimiter} onChange={(e) => set({ delimiter: e.target.value })} aria-label={t('field_delimiter')} placeholder={t('delimiter_custom')} />
              </Space>
            ) : null}
            {v.mode === 'positions' ? text('positions', t('field_positions'), '3, 7', t('field_positions_hint')) : null}
            {v.mode !== 'rows' ? (
              <>
                {v.mode !== 'positions' ? (
                  <Space>
                    <Text strong>{t('field_parts')}</Text>
                    <InputNumber min={2} max={20} value={v.parts} onChange={(n) => set({ parts: n ?? 2 })} aria-label={t('field_parts')} />
                  </Space>
                ) : null}
                {text('into', t('field_new_columns'), 'first_name, last_name', t('split_names_hint'))}
                <Checkbox checked={v.keep} onChange={(e) => set({ keep: e.target.checked })}>{t('keep_original')}</Checkbox>
              </>
            ) : null}
          </Space>
        );
      case 'extract':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {single('column', t('field_column'))}
            <Space wrap>
              {EXTRACT_PRESETS.map((p) => (
                <Tag.CheckableTag key={p.key} checked={v.pattern === p.pattern} onChange={() => set({ pattern: p.pattern, group: p.group })}>
                  {t(`extract_${p.key}`)}
                </Tag.CheckableTag>
              ))}
            </Space>
            {text('pattern', t('field_pattern'), '(\\d+)', t('field_pattern_hint'))}
            {text('into', t('field_new_column'))}
          </Space>
        );
      case 'mask':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('columns', t('field_columns'))}
            <Radio.Group value={v.method} onChange={(e) => set({ method: e.target.value })}>
              {(['hash', 'last4', 'redact'] as const).map((m) => (
                <Radio key={m} value={m}>{t(`mask_${m}`)}</Radio>
              ))}
            </Radio.Group>
          </Space>
        );
      case 'change_case':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('columns', t('field_columns'))}
            <Radio.Group value={v.case} onChange={(e) => set({ case: e.target.value })}>
              <Radio.Button value="upper">UPPER</Radio.Button>
              <Radio.Button value="lower">lower</Radio.Button>
              <Radio.Button value="title">Title Case</Radio.Button>
              <Radio.Button value="sentence">Sentence case</Radio.Button>
            </Radio.Group>
          </Space>
        );
      case 'filter_rows':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Radio.Group value={v.action} onChange={(e) => set({ action: e.target.value })}>
              <Radio.Button value="keep">{t('filter_keep')}</Radio.Button>
              <Radio.Button value="remove">{t('filter_remove')}</Radio.Button>
            </Radio.Group>
            <ConditionBuilder columns={columns} value={v.conditions} onChange={(c) => set({ conditions: c })} match={v.match} onMatchChange={(m) => set({ match: m })} />
          </Space>
        );
      case 'conditional':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {text('into', t('field_new_column'), 'category', columns.includes(v.into) ? t('replaces_column') : undefined)}
            {(v.rules as { conditions: Condition[]; match: 'all' | 'any'; then: { value?: string; column?: string } }[]).map((rule, i) => (
              <div key={i} className="recipe-editor__rule">
                <Text strong>{i === 0 ? t('rule_if') : t('rule_else_if')}</Text>
                <ConditionBuilder
                  columns={columns}
                  value={rule.conditions}
                  match={rule.match}
                  onMatchChange={(m) => set({ rules: v.rules.map((r: object, j: number) => (j === i ? { ...r, match: m } : r)) })}
                  onChange={(c) => set({ rules: v.rules.map((r: object, j: number) => (j === i ? { ...r, conditions: c } : r)) })}
                />
                <Space style={{ marginTop: 6 }}>
                  <Text strong>{t('rule_then')}</Text>
                  <Input size="small" value={rule.then?.value ?? ''} placeholder={t('placeholder_value')} onChange={(e) => set({ rules: v.rules.map((r: object, j: number) => (j === i ? { ...r, then: { value: e.target.value } } : r)) })} aria-label={t('rule_then')} />
                  <Button size="small" type="text" icon={<DeleteOutlined />} aria-label={t('remove_rule')} disabled={v.rules.length === 1} onClick={() => set({ rules: v.rules.filter((_: unknown, j: number) => j !== i) })} />
                </Space>
              </div>
            ))}
            <Button size="small" icon={<PlusOutlined />} onClick={() => set({ rules: [...v.rules, { conditions: [{ column: columns[0], op: 'equals', value: '' }], match: 'all', then: { value: '' } }] })}>
              {t('add_rule')}
            </Button>
            <Space>
              <Text strong>{t('rule_otherwise')}</Text>
              <Input size="small" value={v.otherwise?.value ?? ''} placeholder={t('placeholder_otherwise')} onChange={(e) => set({ otherwise: { value: e.target.value } })} aria-label={t('rule_otherwise')} />
            </Space>
          </Space>
        );
      case 'formula':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {text('into', t('field_new_column'), 'new_column', columns.includes(v.into) ? t('replaces_column') : undefined)}
            <FormulaEditor value={v.expression} language={v.language} onChange={(e) => set({ expression: e })} onLanguageChange={(l) => set({ language: l })} columns={columns} onValidity={setFormulaOk} />
          </Space>
        );
      case 'concat':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('columns', t('field_columns_in_order'), 2)}
            {text('separator', t('field_separator'), ' ')}
            {text('into', t('field_new_column'))}
          </Space>
        );
      case 'sql':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input.TextArea
              value={v.query}
              autoSize={{ minRows: 6, maxRows: 18 }}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 }}
              onChange={(e) => set({ query: e.target.value })}
              aria-label={t('form_sql')}
              spellCheck={false}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>{t('sql_step_hint')}</Text>
          </Space>
        );
      case 'flatten_json':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {single('column', t('field_column'))}
            {text('fields', t('field_json_fields'), 'city, address.country', t('flatten_hint'))}
          </Space>
        );
      case 'dedupe':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('columns', t('field_dedupe_columns'), 0)}
            <Text type="secondary" style={{ fontSize: 12 }}>{t('dedupe_hint')}</Text>
          </Space>
        );
      case 'group':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('by', t('field_group_by'), 0)}
            {(['sum', 'count', 'avg', 'min', 'max'] as const).map((m) => (
              <React.Fragment key={m}>{multi(m, t(`agg_${m}`), 0)}</React.Fragment>
            ))}
          </Space>
        );
      case 'checks':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('notNull', t('check_not_null'), 0)}
            {multi('unique', t('check_unique'), 0)}
            <Space wrap>
              <Select allowClear showSearch placeholder={t('check_allowed_column')} value={v.acceptedColumn} onChange={(val) => set({ acceptedColumn: val })} options={columns.map((c) => ({ value: c, label: c }))} style={{ minWidth: 180 }} aria-label={t('check_allowed_column')} />
              <Input value={v.acceptedValues} onChange={(e) => set({ acceptedValues: e.target.value })} placeholder={t('placeholder_in_list')} style={{ width: 240 }} aria-label={t('check_allowed_values')} />
            </Space>
            <Space wrap>
              <Select allowClear showSearch placeholder={t('check_range_column')} value={v.rangeColumn} onChange={(val) => set({ rangeColumn: val })} options={columns.map((c) => ({ value: c, label: c }))} style={{ minWidth: 180 }} aria-label={t('check_range_column')} />
              <InputNumber value={v.rangeMin === '' ? null : v.rangeMin} onChange={(n) => set({ rangeMin: n ?? '' })} placeholder="0" aria-label={t('check_min')} />
              <InputNumber value={v.rangeMax === '' ? null : v.rangeMax} onChange={(n) => set({ rangeMax: n ?? '' })} placeholder="100" aria-label={t('check_max')} />
            </Space>
            <Radio.Group value={v.onFail} onChange={(e) => set({ onFail: e.target.value })}>
              <Radio value="quarantine">{t('check_set_aside')}</Radio>
              <Radio value="warn">{t('check_warn')}</Radio>
              <Radio value="fail">{t('check_fail')}</Radio>
            </Radio.Group>
          </Space>
        );
      case 'pivot':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {single('on', t('field_pivot_on'))}
            {single('using', t('field_pivot_values'))}
            <Radio.Group value={v.agg} onChange={(e) => set({ agg: e.target.value })}>
              {(['sum', 'count', 'avg', 'min', 'max'] as const).map((m) => (
                <Radio.Button key={m} value={m}>{t(`agg_${m}`)}</Radio.Button>
              ))}
            </Radio.Group>
            {multi('groupBy', t('field_group_by'), 0)}
          </Space>
        );
      case 'merge':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text strong>{t('field_other_table')}</Text>
              <Select showSearch value={v.asset} onChange={(val) => set({ asset: val })} options={tables.map((x) => ({ value: x, label: x }))} style={{ width: '100%' }} aria-label={t('field_other_table')} />
            </Space>
            <Radio.Group value={v.how} onChange={(e) => set({ how: e.target.value })}>
              <Radio.Button value="left">{t('merge_left')}</Radio.Button>
              <Radio.Button value="inner">{t('merge_inner')}</Radio.Button>
              <Radio.Button value="full">{t('merge_full')}</Radio.Button>
            </Radio.Group>
            <Text strong>{t('merge_match')}</Text>
            {(v.pairs as string[][]).map(([l, r], i) => (
              <Space key={i}>
                <Select showSearch value={l || undefined} placeholder={t('merge_this_column')} onChange={(val) => set({ pairs: v.pairs.map((p: string[], j: number) => (j === i ? [val, p[1]] : p)) })} options={columns.map((c) => ({ value: c, label: c }))} style={{ minWidth: 180 }} aria-label={t('merge_this_column')} />
                <Text type="secondary">=</Text>
                <Input value={r} placeholder={t('merge_other_column')} onChange={(e) => set({ pairs: v.pairs.map((p: string[], j: number) => (j === i ? [p[0], e.target.value] : p)) })} style={{ width: 180 }} aria-label={t('merge_other_column')} />
                <Button type="text" icon={<DeleteOutlined />} aria-label={t('remove_pair')} disabled={v.pairs.length === 1} onClick={() => set({ pairs: v.pairs.filter((_: unknown, j: number) => j !== i) })} />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />} onClick={() => set({ pairs: [...v.pairs, ['', '']] })}>{t('add_pair')}</Button>
          </Space>
        );
      case 'append':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text strong>{t('field_other_table')}</Text>
              <Select showSearch value={v.asset} onChange={(val) => set({ asset: val })} options={tables.map((x) => ({ value: x, label: x }))} style={{ width: '100%' }} aria-label={t('field_other_table')} />
            </Space>
            <Checkbox checked={v.all} onChange={(e) => set({ all: e.target.checked })}>{t('append_keep_duplicates')}</Checkbox>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('append_hint')}</Text>
          </Space>
        );
      case 'predict':
      case 'ai_answer': {
        const isPredict = kind === 'predict';
        const field = isPredict ? 'model_id' : 'decision_id';
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text strong>{isPredict ? t('field_model') : t('field_decision')}</Text>
              <Select
                showSearch
                optionFilterProp="label"
                loading={aiChoices === null}
                value={v[field]}
                onChange={(val) => set({ [field]: val })}
                options={(aiChoices ?? []).map((c) => ({ value: c.value, label: c.ready ? c.label : `${c.label} · ${t('predict_not_approved')}`, disabled: !c.ready }))}
                notFoundContent={aiChoices === null ? undefined : (
                  <Text type="secondary">{isPredict ? t('predict_none') : t('ai_answer_none')}</Text>
                )}
                style={{ width: '100%' }}
                aria-label={isPredict ? t('field_model') : t('field_decision')}
              />
            </Space>
            {isPredict ? null : multi('columns', t('field_ai_columns'))}
            {text('into', t('field_output_column'), isPredict ? t('placeholder_predict_column') : t('placeholder_ai_column'))}
            <Text type="secondary" style={{ fontSize: 12 }}>{isPredict ? t('predict_hint') : t('ai_answer_hint')}</Text>
          </Space>
        );
      }
      case 'unpivot':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('columns', t('field_unpivot_columns'))}
            {text('name', t('field_unpivot_name'), 'attribute')}
            {text('value', t('field_unpivot_value'), 'value')}
          </Space>
        );
    }
  })();

  // A stale preview from an earlier, now-incomplete form is not shown.
  const draft = ready ? draftState : null;
  const draftError = ready ? draftErrorState : null;
  // Before → after for the columns this step touches (or adds), on the first rows.
  const touched = step ? stepColumns(step) : [];
  const added = draft?.columns.map((c) => c.name).filter((c) => !columns.includes(c)) ?? [];
  const shown = Array.from(new Set([...touched.filter((c) => draft?.columns.some((d) => d.name === c)), ...added])).slice(0, 4);
  const last = draft?.step_stats?.[draft.step_stats.length - 1];
  // Row-by-row before/after only makes sense when the step keeps every row in place.
  const aligned = Boolean(draft) && !last?.rows_delta;
  const previewRows = (draft?.rows ?? []).slice(0, 8).map((row, i) => ({ key: i, before: aligned ? before[i] : undefined, after: row }));

  return (
    <Modal
      open={open}
      width={kind === 'formula' || kind === 'conditional' || kind === 'rename_all' ? 820 : 640}
      title={t(`form_${kind}`, { column: selected[0] ?? '' })}
      okText={existing ? t('save_step') : t('add_step')}
      okButtonProps={{ disabled: !step || Boolean(draftError) }}
      onOk={() => step && onSubmit(existing ? withMeta(step, existing) : step)}
      onCancel={onCancel}
      destroyOnHidden
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        {body}
        <div className="recipe-editor__draft">
          <Text strong>{t('draft_preview')}</Text>
          {draftError ? <Alert type="error" showIcon message={draftError} /> : null}
          {last && !draftError ? (
            <Space wrap size={4}>
              {last.rows_delta ? <Tag color="orange">{t('stat_rows', { delta: last.rows_delta })}</Tag> : null}
              {last.added?.length ? <Tag color="green">{t('stat_added', { count: last.added.length })}</Tag> : null}
              {last.removed?.length ? <Tag>{t('stat_removed', { count: last.removed.length })}</Tag> : null}
              {Object.entries(last.emptied ?? {}).map(([c, n]) => (
                <Tag key={c} color="red">{t('stat_emptied', { count: n, column: c })}</Tag>
              ))}
              {!last.rows_delta && !last.added?.length && !last.removed?.length && !Object.keys(last.emptied ?? {}).length ? (
                <Tag color="green">{t('stat_clean')}</Tag>
              ) : null}
            </Space>
          ) : null}
          {draft && shown.length ? (
            <Table
              size="small"
              pagination={false}
              dataSource={previewRows}
              scroll={{ x: 'max-content' }}
              columns={shown.map((c) => ({
                title: c,
                key: c,
                render: (_: unknown, r: { before?: Record<string, unknown>; after: Record<string, unknown> }) => {
                  const b = r.before?.[c];
                  const a = r.after[c];
                  const changed = String(b ?? '') !== String(a ?? '');
                  return (
                    <span className={changed ? 'recipe-editor__cell--changed' : undefined}>
                      {changed && b !== undefined ? <Text delete type="secondary">{String(b ?? '')}</Text> : null}
                      {changed && b !== undefined ? ' → ' : null}
                      {a === null || a === undefined ? <Text type="secondary" italic>{t('empty_cell')}</Text> : String(a)}
                    </span>
                  );
                },
              }))}
            />
          ) : !draft && !draftError ? (
            <Text type="secondary">{step ? t('loading_preview') : t('draft_fill_form')}</Text>
          ) : null}
        </div>
      </Space>
    </Modal>
  );
}

/** Keep a step's label and on/off state when its settings are edited. */
function withMeta(next: PrepStep, existing: PrepStep): PrepStep {
  const [, old] = stepParts(existing);
  const [kind, args] = stepParts(next);
  return { [kind]: { ...args, ...(old.note ? { note: old.note } : {}), ...(old.disabled ? { disabled: true } : {}) } };
}
