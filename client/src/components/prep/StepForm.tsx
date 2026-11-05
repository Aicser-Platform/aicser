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
  | 'ai_answer'
  | 'window'
  | 'bin'
  | 'index'
  | 'top_n'
  | 'remove_rows'
  | 'header_rows'
  | 'split_rows'
  | 'expand_rows';

/** Calculations across rows, in the order people reach for them. */
export const WINDOW_CALCS = ['running_total', 'previous', 'difference', 'percent_of_total', 'rank', 'moving_average',
  'cumulative_percent', 'next', 'dense_rank', 'row_number'] as const;
const NEEDS_ORDER = new Set(['running_total', 'moving_average', 'previous', 'next', 'difference', 'cumulative_percent']);

/** Column names from one or more header rows: joined, trimmed, never empty, never repeated. */
export function headerNames(rows: Record<string, unknown>[], columns: string[], joiner: string): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  columns.forEach((c) => {
    const parts = rows.map((r) => String(r[c] ?? '').trim()).filter(Boolean);
    let name = parts.join(joiner).trim() || c;
    const base = name;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} ${n}`;
    used.add(name.toLowerCase());
    out[c] = name;
  });
  return out;
}

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
    predict: 'predict', ai_answer: 'ai_answer', window: 'window', bin: 'bin', index: 'index', top_n: 'top_n',
    remove_rows: 'remove_rows', header_rows: 'header_rows', explode: 'expand_rows',
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
      return { asset: a.asset, how: a.how ?? 'left', pairs: pairs.length ? pairs : [[selected[0] ?? '', '']], match: a.match ?? 'exact', threshold: a.threshold ?? 0.9 };
    }
    case 'append':
      return { asset: a.asset, all: a.all ?? true };
    case 'predict':
      return { model_id: a.model_id, into: a.into ?? '' };
    case 'ai_answer':
      return { decision_id: a.decision_id, columns: cols, into: a.into ?? '' };
    case 'window':
      return {
        calc: a.calc ?? 'running_total', column: (a.column as string) ?? selected[0], into: a.into ?? '',
        partitionBy: (a.partition_by as string[]) ?? [], orderBy: a.order_by, descending: Boolean(a.descending),
        size: a.size ?? 3, offset: a.offset ?? 1,
      };
    case 'bin':
      return {
        column: (a.column as string) ?? selected[0], into: a.into ?? `${selected[0] ?? 'value'}_range`, mode: a.mode ?? 'edges',
        edges: ((a.edges as number[]) ?? []).join(', '), count: a.count ?? 4, labels: ((a.labels as string[]) ?? []).join(', '),
      };
    case 'index':
      return { into: a.into ?? 'row_no', start: a.start ?? 1, partitionBy: (a.partition_by as string[]) ?? [], orderBy: a.order_by, descending: Boolean(a.descending) };
    case 'top_n':
      return { n: a.n ?? 3, orderBy: a.order_by ?? selected[0], descending: a.descending ?? true, partitionBy: (a.partition_by as string[]) ?? [] };
    case 'remove_rows':
      return { top: a.top ?? 1, bottom: a.bottom ?? 0 };
    case 'header_rows':
      return { skip: a.skip ?? 0, rows: a.rows ?? 1, joiner: ' ', names: (a.names as Record<string, string>) ?? null };
    case 'split_rows':
      return { column: (a.column as string) ?? selected[0], format: 'auto', delimiter: ',' };
    case 'expand_rows': {
      const picked = ((a.columns as string[]) ?? []).length ? (a.columns as string[]) : a.column ? [a.column as string] : selected;
      return { columns: picked, format: a.json === false ? 'text' : 'json', delimiter: a.delimiter ?? ',' };
    }
  }
}

const listOf = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean);

export function buildStep(kind: FormKind, v: Values, columns: string[]): PrepStep | null {
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
      const similar = v.match === 'similar' ? { match: 'similar', threshold: Number(v.threshold) || 0.9 } : {};
      return v.asset && Object.keys(on).length ? { join: { asset: v.asset, how: v.how, on, ...similar } } : null;
    }
    case 'append':
      return v.asset ? { union: { asset: v.asset, all: v.all } } : null;
    case 'predict':
      return v.model_id ? { predict: { model_id: v.model_id, ...(String(v.into ?? '').trim() ? { into: v.into.trim() } : {}) } } : null;
    case 'ai_answer':
      return v.decision_id && v.columns?.length
        ? { ai_answer: { decision_id: v.decision_id, columns: v.columns, ...(String(v.into ?? '').trim() ? { into: v.into.trim() } : {}) } }
        : null;
    case 'window': {
      const into = String(v.into ?? '').trim() || `${v.calc}_${v.column ?? 'value'}`;
      if (v.calc !== 'row_number' && !v.column) return null;
      if (NEEDS_ORDER.has(v.calc) && !v.orderBy) return null;
      return {
        window: {
          calc: v.calc, ...(v.column ? { column: v.column } : {}), into,
          ...(v.partitionBy?.length ? { partition_by: v.partitionBy } : {}), ...(v.orderBy ? { order_by: v.orderBy } : {}),
          ...(v.descending ? { descending: true } : {}),
          ...(v.calc === 'moving_average' ? { size: Number(v.size) || 3 } : {}),
          ...(v.calc === 'previous' || v.calc === 'next' ? { offset: Number(v.offset) || 1 } : {}),
        },
      };
    }
    case 'bin': {
      if (!v.column || !String(v.into ?? '').trim()) return null;
      if (v.mode === 'edges') {
        const edges = listOf(String(v.edges)).map(Number).filter(Number.isFinite);
        const labels = listOf(String(v.labels));
        if (!edges.length) return null;
        return { bin: { column: v.column, into: v.into.trim(), mode: 'edges', edges, ...(labels.length ? { labels } : {}) } };
      }
      return { bin: { column: v.column, into: v.into.trim(), mode: v.mode, count: Number(v.count) || 4 } };
    }
    case 'index':
      return String(v.into ?? '').trim()
        ? {
            index: {
              into: v.into.trim(), start: Number(v.start) || 1, ...(v.partitionBy?.length ? { partition_by: v.partitionBy } : {}),
              ...(v.orderBy ? { order_by: v.orderBy, ...(v.descending ? { descending: true } : {}) } : {}),
            },
          }
        : null;
    case 'top_n':
      return v.orderBy && Number(v.n) >= 1
        ? { top_n: { n: Number(v.n), order_by: v.orderBy, descending: Boolean(v.descending), ...(v.partitionBy?.length ? { partition_by: v.partitionBy } : {}) } }
        : null;
    case 'remove_rows': {
      const top = Math.max(0, Number(v.top) || 0);
      const bottom = Math.max(0, Number(v.bottom) || 0);
      return top || bottom ? { remove_rows: { ...(top ? { top } : {}), ...(bottom ? { bottom } : {}) } } : null;
    }
    case 'header_rows':
      return v.names && Object.keys(v.names).length
        ? { header_rows: { skip: Number(v.skip) || 0, rows: Number(v.rows) || 1, names: v.names } }
        : null;
    case 'split_rows': {
      if (!v.column) return null;
      return v.format === 'json'
        ? { explode: { columns: [v.column], json: true } }
        : { explode: { columns: [v.column], json: false, delimiter: v.delimiter || ',' } };
    }
    case 'expand_rows':
      return v.columns?.length
        ? { explode: { columns: v.columns, ...(v.format === 'text' ? { json: false, delimiter: v.delimiter || ',' } : { json: true }) } }
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
  // Split into rows: look at the column's values to choose a JSON list or a delimiter, so the
  // common case needs no setting at all.
  useEffect(() => {
    if (kind !== 'split_rows' || v.format !== 'auto') return;
    const values = before.map((r) => String(r[v.column] ?? '').trim()).filter(Boolean).slice(0, 50);
    if (values.length && values.every((x) => x.startsWith('[') && x.endsWith(']'))) {
      set({ format: 'json' });
      return;
    }
    const delimiter = [';', '|', ',', '\n'].map((d) => [d, values.filter((x) => x.includes(d)).length] as const)
      .sort((a, b) => b[1] - a[1])[0];
    set({ format: 'text', delimiter: delimiter && delimiter[1] ? delimiter[0] : ',' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, v.format, v.column]);
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
            <Radio.Group value={v.match} onChange={(e) => set({ match: e.target.value })}>
              <Radio value="exact">{t('merge_exact')}</Radio>
              <Radio value="similar">{t('merge_similar')}</Radio>
            </Radio.Group>
            {v.match === 'similar' ? (
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <Space>
                  <Text>{t('merge_similarity')}</Text>
                  <InputNumber min={0.5} max={1} step={0.05} value={v.threshold} onChange={(val) => set({ threshold: val ?? 0.9 })} aria-label={t('merge_similarity')} />
                </Space>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('merge_similar_hint')}</Text>
              </Space>
            ) : null}
          </Space>
        );
      case 'window':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text strong>{t('field_calculation')}</Text>
              <Select value={v.calc} onChange={(val) => set({ calc: val })} options={WINDOW_CALCS.map((c) => ({ value: c, label: t(`calc_${c}`) }))} style={{ width: '100%' }} aria-label={t('field_calculation')} />
            </Space>
            {v.calc !== 'row_number' ? single('column', t('field_value_column')) : null}
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text strong>{t('field_order_by')}</Text>
              <Space.Compact style={{ width: '100%' }}>
                <Select showSearch allowClear value={v.orderBy} onChange={(val) => set({ orderBy: val })} options={columns.map((c) => ({ value: c, label: c }))} style={{ width: '100%' }} aria-label={t('field_order_by')} status={NEEDS_ORDER.has(v.calc) && !v.orderBy ? 'warning' : undefined} />
                <Select value={v.descending ? 'desc' : 'asc'} onChange={(val) => set({ descending: val === 'desc' })} options={[{ value: 'asc', label: t('order_asc') }, { value: 'desc', label: t('order_desc') }]} style={{ width: 140 }} aria-label={t('field_direction')} />
              </Space.Compact>
            </Space>
            {multi('partitionBy', t('field_per_group'), 0)}
            {v.calc === 'moving_average' ? (
              <Space><Text>{t('field_window_rows')}</Text><InputNumber min={1} max={1000} value={v.size} onChange={(val) => set({ size: val ?? 3 })} aria-label={t('field_window_rows')} /></Space>
            ) : null}
            {v.calc === 'previous' || v.calc === 'next' ? (
              <Space><Text>{t('field_rows_away')}</Text><InputNumber min={1} max={1000} value={v.offset} onChange={(val) => set({ offset: val ?? 1 })} aria-label={t('field_rows_away')} /></Space>
            ) : null}
            {text('into', t('field_new_column'), `${v.calc}_${v.column ?? 'value'}`)}
          </Space>
        );
      case 'bin':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {single('column', t('field_number_column'))}
            <Radio.Group value={v.mode} onChange={(e) => set({ mode: e.target.value })}>
              <Radio.Button value="edges">{t('bin_edges')}</Radio.Button>
              <Radio.Button value="equal_width">{t('bin_equal_width')}</Radio.Button>
              <Radio.Button value="quantiles">{t('bin_quantiles')}</Radio.Button>
            </Radio.Group>
            {v.mode === 'edges' ? (
              <>
                {text('edges', t('field_boundaries'), '10000, 50000', t('bin_edges_hint'))}
                {text('labels', t('field_range_labels'), t('bin_labels_placeholder'))}
              </>
            ) : (
              <Space><Text>{t('field_range_count')}</Text><InputNumber min={2} max={100} value={v.count} onChange={(val) => set({ count: val ?? 4 })} aria-label={t('field_range_count')} /></Space>
            )}
            {text('into', t('field_new_column'))}
          </Space>
        );
      case 'index':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {text('into', t('field_new_column'))}
            <Space><Text>{t('field_start_at')}</Text><InputNumber value={v.start} onChange={(val) => set({ start: val ?? 1 })} aria-label={t('field_start_at')} /></Space>
            {multi('partitionBy', t('field_restart_per_group'), 0)}
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Text strong>{t('field_order_by')}</Text>
              <Select showSearch allowClear value={v.orderBy} placeholder={t('index_keep_order')} onChange={(val) => set({ orderBy: val })} options={columns.map((c) => ({ value: c, label: c }))} style={{ width: '100%' }} aria-label={t('field_order_by')} />
            </Space>
          </Space>
        );
      case 'top_n':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>
              <Radio.Group value={v.descending ? 'top' : 'bottom'} onChange={(e) => set({ descending: e.target.value === 'top' })}>
                <Radio.Button value="top">{t('topn_top')}</Radio.Button>
                <Radio.Button value="bottom">{t('topn_bottom')}</Radio.Button>
              </Radio.Group>
              <InputNumber min={1} max={100000} value={v.n} onChange={(val) => set({ n: val ?? 1 })} aria-label={t('field_how_many')} />
            </Space>
            {single('orderBy', t('field_by_column'))}
            {multi('partitionBy', t('field_per_group'), 0)}
          </Space>
        );
      case 'remove_rows':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space><Text>{t('field_remove_top')}</Text><InputNumber min={0} max={1000000} value={v.top} onChange={(val) => set({ top: val ?? 0 })} aria-label={t('field_remove_top')} /></Space>
            <Space><Text>{t('field_remove_bottom')}</Text><InputNumber min={0} max={1000000} value={v.bottom} onChange={(val) => set({ bottom: val ?? 0 })} aria-label={t('field_remove_bottom')} /></Space>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('remove_rows_hint')}</Text>
          </Space>
        );
      case 'header_rows': {
        const names = v.names ?? headerNames(before.slice(Number(v.skip) || 0, (Number(v.skip) || 0) + (Number(v.rows) || 1)), columns, v.joiner ?? ' ');
        const regen = (patch: Values) => {
          const next = { ...v, ...patch };
          const skip = Number(next.skip) || 0;
          set({ ...patch, names: headerNames(before.slice(skip, skip + (Number(next.rows) || 1)), columns, next.joiner ?? ' ') });
        };
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space wrap>
              <Text>{t('field_rows_above')}</Text>
              <InputNumber min={0} max={100} value={v.skip} onChange={(val) => regen({ skip: val ?? 0 })} aria-label={t('field_rows_above')} />
              <Text>{t('field_header_rows')}</Text>
              <InputNumber min={1} max={10} value={v.rows} onChange={(val) => regen({ rows: val ?? 1 })} aria-label={t('field_header_rows')} />
              {Number(v.rows) > 1 ? (
                <>
                  <Text>{t('field_joined_with')}</Text>
                  <Input value={v.joiner} onChange={(e) => regen({ joiner: e.target.value })} style={{ width: 70 }} aria-label={t('field_joined_with')} />
                </>
              ) : null}
            </Space>
            <Table
              size="small"
              pagination={false}
              rowKey="from"
              scroll={{ y: 240 }}
              dataSource={Object.entries(names).map(([from, to]) => ({ from, to }))}
              columns={[
                { title: t('col_before'), dataIndex: 'from' },
                {
                  title: t('col_after'),
                  dataIndex: 'to',
                  render: (to: string, row: { from: string }) => (
                    <Input size="small" value={to} onChange={(e) => set({ names: { ...names, [row.from]: e.target.value } })} aria-label={row.from} />
                  ),
                },
              ]}
            />
          </Space>
        );
      }
      case 'split_rows':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Radio.Group value={v.format === 'json' ? 'json' : 'text'} onChange={(e) => set({ format: e.target.value })}>
              <Radio.Button value="text">{t('rows_from_text')}</Radio.Button>
              <Radio.Button value="json">{t('rows_from_json')}</Radio.Button>
            </Radio.Group>
            {v.format !== 'json' ? text('delimiter', t('field_delimiter'), ',') : null}
            <Text type="secondary" style={{ fontSize: 12 }}>{t('split_rows_hint')}</Text>
          </Space>
        );
      case 'expand_rows':
        return (
          <Space direction="vertical" style={{ width: '100%' }}>
            {multi('columns', t('field_list_columns'))}
            <Radio.Group value={v.format} onChange={(e) => set({ format: e.target.value })}>
              <Radio.Button value="json">{t('rows_from_json')}</Radio.Button>
              <Radio.Button value="text">{t('rows_from_text')}</Radio.Button>
            </Radio.Group>
            {v.format === 'text' ? text('delimiter', t('field_delimiter'), ',') : null}
            <Text type="secondary" style={{ fontSize: 12 }}>{t('expand_rows_hint')}</Text>
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
