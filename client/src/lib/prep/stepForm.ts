// Step forms' logic (which form edits a step, its starting values, the step it builds), ported from
// ../aicser/client/src/components/prep/StepForm.tsx @ 749d38d (see PORTING.md). Changes: split from the AntD
// form (components/prep/StepForm.tsx). Web: also the Predict / AI answer forms (Enterprise models and AI decisions),
// which the desktop leaves to YAML.
import { stepParts, type PrepStep, type TypeSpec } from '@/api/prep';
import { conditionsComplete, type Condition } from './conditions';
import { renameAllMapping, steps as build, type Convention } from './recipeSteps';

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
  | 'predict'
  | 'ai_answer'
  | 'append'
  | 'sql'
  | 'window'
  | 'bin'
  | 'index'
  | 'top_n'
  | 'remove_rows'
  | 'header_rows'
  | 'split_rows'
  | 'expand_rows';

/** Calculations across rows, in the order people reach for them. */
export const WINDOW_CALCS = [
  'running_total',
  'previous',
  'difference',
  'percent_of_total',
  'rank',
  'moving_average',
  'cumulative_percent',
  'next',
  'dense_rank',
  'row_number',
] as const;
export const NEEDS_ORDER = new Set([
  'running_total',
  'moving_average',
  'previous',
  'next',
  'difference',
  'cumulative_percent',
]);

/** Column names from one or more header rows: joined, trimmed, never empty, never repeated. */
export function headerNames(
  rows: Record<string, unknown>[],
  columns: string[],
  joiner: string
): Record<string, string> {
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
    if (specs.length && specs.every((s) => s.type === 'number' || s.type === 'integer' || s.type === 'decimal'))
      return 'type_number';
    return null;
  }
  const map: Record<string, FormKind> = {
    rename: 'rename_all',
    replace: 'replace',
    fill: 'fill',
    split: 'split',
    extract: 'extract',
    mask: 'mask',
    change_case: 'change_case',
    filter_rows: 'filter_rows',
    conditional: 'conditional',
    formula: 'formula',
    concat: 'concat',
    flatten_json: 'flatten_json',
    dedupe: 'dedupe',
    aggregate: 'group',
    unpivot: 'unpivot',
    validate: 'checks',
    pivot: 'pivot',
    join: 'merge',
    union: 'append',
    predict: 'predict',
    ai_answer: 'ai_answer',
    sql: 'sql',
    window: 'window',
    bin: 'bin',
    index: 'index',
    top_n: 'top_n',
    remove_rows: 'remove_rows',
    header_rows: 'header_rows',
    explode: 'expand_rows',
  };
  return map[kind] ?? null;
}

// Form values differ per step kind (web keeps them loose too); typing each kind would double this file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
export type Values = Record<string, any>;

export function initialValues(
  kind: FormKind,
  columns: string[],
  selected: string[],
  existing?: PrepStep,
  detected?: TypeSpec
): Values {
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
      return {
        columns: existing ? Object.keys((a.columns as object) ?? {}) : selected,
        locale: spec?.locale ?? 'us',
        type: spec?.type ?? 'number',
      };
    }
    case 'replace': {
      const pairs = Object.entries((a.mapping as Record<string, string>) ?? {});
      if (a.find) pairs.unshift([String(a.find), String(a.replace_with ?? '')]);
      return {
        columns: cols,
        pairs: pairs.length ? pairs : [['', '']],
        match: a.match ?? (a.regex ? 'regex' : 'contains'),
        caseSensitive: a.case_sensitive ?? false,
      };
    }
    case 'fill':
      return { columns: cols, strategy: a.strategy ?? 'value', value: a.value ?? '' };
    case 'split':
      return {
        column: (a.column as string) ?? selected[0],
        mode: a.mode ?? 'whitespace',
        delimiter: a.delimiter ?? ',',
        positions: ((a.positions as number[]) ?? []).join(', '),
        into: ((a.into as string[]) ?? []).join(', '),
        parts: a.parts ?? 2,
        keep: Boolean(a.keep_original),
      };
    case 'extract':
      return {
        column: (a.column as string) ?? selected[0],
        pattern: a.pattern ?? '(\\d+)',
        into: a.into ?? `${selected[0] ?? 'value'}_part`,
        group: a.group_index ?? 1,
      };
    case 'mask':
      return { columns: cols, method: a.method ?? 'hash' };
    case 'change_case':
      return { columns: cols, case: a.case ?? 'title' };
    case 'filter_rows':
      return {
        conditions: (a.conditions as Condition[]) ?? [
          { column: selected[0] ?? columns[0] ?? '', op: 'equals', value: '' },
        ],
        match: a.match ?? 'all',
        action: a.action ?? 'keep',
      };
    case 'conditional':
      return {
        into: a.into ?? 'category',
        rules: (a.rules as unknown[]) ?? [
          {
            conditions: [{ column: selected[0] ?? columns[0] ?? '', op: 'gt', value: '' }],
            match: 'all',
            then: { value: '' },
          },
        ],
        otherwise: a.otherwise ?? { value: '' },
      };
    case 'formula':
      return { into: a.into ?? 'new_column', expression: a.expression ?? '', language: a.language ?? 'excel' };
    case 'concat':
      return { columns: cols.length >= 2 ? cols : [], into: a.into ?? 'combined', separator: a.separator ?? ' ' };
    case 'sql':
      return { query: (a.query as string) ?? 'SELECT *\nFROM {input}' };
    case 'flatten_json':
      return {
        column: (a.column as string) ?? selected[0],
        fields: Object.keys((a.fields as object) ?? {}).join(', '),
      };
    case 'dedupe':
      return { columns: (a.keys as string[]) ?? selected };
    case 'group':
      return {
        by: (a.by as string[]) ?? selected,
        sum: a.sum ?? [],
        count: a.count ?? [],
        avg: a.avg ?? [],
        min: a.min ?? [],
        max: a.max ?? [],
      };
    case 'unpivot':
      return { columns: cols, name: a.name_column ?? 'attribute', value: a.value_column ?? 'value' };
    case 'checks': {
      const accepted = Object.entries((a.accepted_values as Record<string, string[]>) ?? {})[0];
      const range = Object.entries((a.range as Record<string, unknown[]>) ?? {})[0];
      return {
        notNull: (a.not_null as string[]) ?? selected,
        unique: (a.unique as string[]) ?? [],
        acceptedColumn: accepted?.[0],
        acceptedValues: (accepted?.[1] ?? []).join(', '),
        rangeColumn: range?.[0],
        rangeMin: range?.[1]?.[0] ?? '',
        rangeMax: range?.[1]?.[1] ?? '',
        onFail: a.on_fail ?? 'quarantine',
      };
    }
    case 'pivot':
      return { on: a.on ?? selected[0], using: a.using, agg: a.agg ?? 'sum', groupBy: (a.group_by as string[]) ?? [] };
    case 'merge': {
      const pairs = Object.entries((a.on as Record<string, string>) ?? {});
      return {
        asset: a.asset,
        how: a.how ?? 'left',
        pairs: pairs.length ? pairs : [[selected[0] ?? '', '']],
        match: a.match ?? 'exact',
        threshold: a.threshold ?? 0.9,
      };
    }
    case 'append':
      return { asset: a.asset, all: a.all ?? true };
    case 'predict':
      return { model_id: a.model_id, into: a.into ?? '' };
    case 'ai_answer':
      return { decision_id: a.decision_id, columns: (a.columns as string[] | undefined) ?? selected, into: a.into ?? '' };
    case 'window':
      return {
        calc: a.calc ?? 'running_total',
        column: (a.column as string) ?? selected[0],
        into: a.into ?? '',
        partitionBy: (a.partition_by as string[]) ?? [],
        orderBy: a.order_by,
        descending: Boolean(a.descending),
        size: a.size ?? 3,
        offset: a.offset ?? 1,
      };
    case 'bin':
      return {
        column: (a.column as string) ?? selected[0],
        into: a.into ?? `${selected[0] ?? 'value'}_range`,
        mode: a.mode ?? 'edges',
        edges: ((a.edges as number[]) ?? []).join(', '),
        count: a.count ?? 4,
        labels: ((a.labels as string[]) ?? []).join(', '),
      };
    case 'index':
      return {
        into: a.into ?? 'row_no',
        start: a.start ?? 1,
        partitionBy: (a.partition_by as string[]) ?? [],
        orderBy: a.order_by,
        descending: Boolean(a.descending),
      };
    case 'top_n':
      return {
        n: a.n ?? 3,
        orderBy: a.order_by ?? selected[0],
        descending: a.descending ?? true,
        partitionBy: (a.partition_by as string[]) ?? [],
      };
    case 'remove_rows':
      return { top: a.top ?? 1, bottom: a.bottom ?? 0 };
    case 'header_rows':
      return { skip: a.skip ?? 0, rows: a.rows ?? 1, joiner: ' ', names: (a.names as Record<string, string>) ?? null };
    case 'split_rows':
      return { column: (a.column as string) ?? selected[0], format: 'auto', delimiter: ',' };
    case 'expand_rows': {
      const picked = ((a.columns as string[]) ?? []).length
        ? (a.columns as string[])
        : a.column
          ? [a.column as string]
          : selected;
      return { columns: picked, format: a.json === false ? 'text' : 'json', delimiter: a.delimiter ?? ',' };
    }
  }
}

const listOf = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

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
        ? {
            set_types: {
              columns: Object.fromEntries(
                v.columns.map((c: string) => [
                  c,
                  {
                    type: v.withTime ? 'datetime' : 'date',
                    formats: v.formats,
                    ...(v.excel ? { excel_serial: true } : {}),
                  },
                ])
              ),
            },
          }
        : null;
    case 'type_number':
      return v.columns?.length
        ? {
            set_types: {
              columns: Object.fromEntries(v.columns.map((c: string) => [c, { type: v.type, locale: v.locale }])),
            },
          }
        : null;
    case 'replace': {
      const pairs = Object.fromEntries((v.pairs as string[][]).filter(([f]) => f !== ''));
      return v.columns?.length && Object.keys(pairs).length
        ? build.replace(v.columns, pairs, v.match, v.caseSensitive)
        : null;
    }
    case 'fill': {
      if (!v.columns?.length) return null;
      const raw = String(v.value ?? '');
      const num = Number(raw);
      return build.fill(
        v.columns,
        v.strategy,
        v.strategy === 'value' ? (raw !== '' && Number.isFinite(num) ? num : raw) : undefined
      );
    }
    case 'split': {
      if (!v.column) return null;
      const positions = listOf(String(v.positions))
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      if (v.mode === 'positions' && !positions.length) return null;
      return build.split(v.column, {
        mode: v.mode,
        delimiter: v.mode === 'delimiter' || v.mode === 'rows' ? v.delimiter : undefined,
        positions: v.mode === 'positions' ? positions : undefined,
        into: listOf(String(v.into)),
        parts: Number(v.parts) || 2,
        ...(v.keep ? { keep_original: true } : {}),
      } as never);
    }
    case 'extract':
      return v.column && v.pattern && v.into
        ? build.extract(v.column, v.pattern, v.into.trim(), Number(v.group) || 0)
        : null;
    case 'mask':
      return v.columns?.length ? build.mask(v.columns, v.method) : null;
    case 'change_case':
      return v.columns?.length ? build.changeCase(v.columns, v.case) : null;
    case 'filter_rows':
      return conditionsComplete(v.conditions)
        ? { filter_rows: { conditions: v.conditions, match: v.match, action: v.action } }
        : null;
    case 'conditional': {
      const rules = v.rules as { conditions: Condition[] }[];
      if (!v.into || !rules.length || !rules.every((r) => conditionsComplete(r.conditions))) return null;
      return {
        conditional: {
          into: v.into.trim(),
          rules,
          otherwise: v.otherwise,
          ...(columns.includes(v.into.trim()) ? { replace: true } : {}),
        },
      };
    }
    case 'formula':
      return v.into && v.expression.trim()
        ? build.formula(v.into.trim(), v.expression, v.language, columns.includes(v.into.trim()))
        : null;
    case 'concat':
      return v.columns?.length >= 2 && v.into ? build.concat(v.columns, v.into.trim(), v.separator) : null;
    case 'sql': {
      // One statement over the previous step's result, which the engine names {input}.
      const query = String(v.query ?? '')
        .trim()
        .replace(/;\s*$/, '');
      return query.includes('{input}') && !query.includes(';') ? { sql: { query } } : null;
    }
    case 'flatten_json': {
      const fields = Object.fromEntries(
        listOf(String(v.fields)).map((f) => [f.replace(/[^A-Za-z0-9_]/g, '_'), `$.${f}`])
      );
      return v.column && Object.keys(fields).length ? build.flattenJson(v.column, fields) : null;
    }
    case 'dedupe':
      return v.columns?.length ? build.dedupeBy(v.columns) : build.dedupeRows();
    case 'group': {
      const measures = ['sum', 'count', 'avg', 'min', 'max'].reduce(
        (acc, k) => (v[k]?.length ? { ...acc, [k]: v[k] } : acc),
        {}
      );
      return Object.keys(measures).length ? { aggregate: { by: v.by ?? [], ...measures } } : null;
    }
    case 'unpivot':
      return v.columns?.length
        ? { unpivot: { columns: v.columns, name_column: v.name || 'attribute', value_column: v.value || 'value' } }
        : null;
    case 'checks': {
      const rules: Record<string, unknown> = {};
      if (v.notNull?.length) rules.not_null = v.notNull;
      if (v.unique?.length) rules.unique = v.unique;
      if (v.acceptedColumn && listOf(String(v.acceptedValues)).length)
        rules.accepted_values = { [v.acceptedColumn]: listOf(String(v.acceptedValues)) };
      if (v.rangeColumn && String(v.rangeMin) !== '' && String(v.rangeMax) !== '') {
        rules.range = { [v.rangeColumn]: [Number(v.rangeMin), Number(v.rangeMax)] };
      }
      return Object.keys(rules).length ? { validate: { ...rules, on_fail: v.onFail } } : null;
    }
    case 'pivot':
      return v.on && v.using
        ? { pivot: { on: v.on, using: v.using, agg: v.agg, ...(v.groupBy?.length ? { group_by: v.groupBy } : {}) } }
        : null;
    case 'merge': {
      const on = Object.fromEntries((v.pairs as string[][]).filter(([l, r]) => l && r));
      const similar = v.match === 'similar' ? { match: 'similar', threshold: Number(v.threshold) || 0.9 } : {};
      return v.asset && Object.keys(on).length ? { join: { asset: v.asset, how: v.how, on, ...similar } } : null;
    }
    case 'append':
      return v.asset ? { union: { asset: v.asset, all: v.all } } : null;
    case 'predict':
      return v.model_id
        ? { predict: { model_id: v.model_id, ...(String(v.into ?? '').trim() ? { into: String(v.into).trim() } : {}) } }
        : null;
    case 'ai_answer':
      return v.decision_id && v.columns?.length
        ? {
            ai_answer: {
              decision_id: v.decision_id,
              columns: v.columns,
              ...(String(v.into ?? '').trim() ? { into: String(v.into).trim() } : {}),
            },
          }
        : null;
    case 'window': {
      const into = String(v.into ?? '').trim() || `${v.calc}_${v.column ?? 'value'}`;
      if (v.calc !== 'row_number' && !v.column) return null;
      if (NEEDS_ORDER.has(v.calc) && !v.orderBy) return null;
      return {
        window: {
          calc: v.calc,
          ...(v.column ? { column: v.column } : {}),
          into,
          ...(v.partitionBy?.length ? { partition_by: v.partitionBy } : {}),
          ...(v.orderBy ? { order_by: v.orderBy } : {}),
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
        return {
          bin: { column: v.column, into: v.into.trim(), mode: 'edges', edges, ...(labels.length ? { labels } : {}) },
        };
      }
      return { bin: { column: v.column, into: v.into.trim(), mode: v.mode, count: Number(v.count) || 4 } };
    }
    case 'index':
      return String(v.into ?? '').trim()
        ? {
            index: {
              into: v.into.trim(),
              start: Number(v.start) || 1,
              ...(v.partitionBy?.length ? { partition_by: v.partitionBy } : {}),
              ...(v.orderBy ? { order_by: v.orderBy, ...(v.descending ? { descending: true } : {}) } : {}),
            },
          }
        : null;
    case 'top_n':
      return v.orderBy && Number(v.n) >= 1
        ? {
            top_n: {
              n: Number(v.n),
              order_by: v.orderBy,
              descending: Boolean(v.descending),
              ...(v.partitionBy?.length ? { partition_by: v.partitionBy } : {}),
            },
          }
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
        ? {
            explode: {
              columns: v.columns,
              ...(v.format === 'text' ? { json: false, delimiter: v.delimiter || ',' } : { json: true }),
            },
          }
        : null;
  }
}

/** Patterns people reach for most, so Extract doesn't start from a blank regex. */
export const EXTRACT_PRESETS = [
  { key: 'first_number', pattern: '(\\d+)', group: 1 },
  { key: 'decimal_number', pattern: '(-?\\d+(?:[.,]\\d+)?)', group: 1 },
  { key: 'letters', pattern: '([A-Za-z]+)', group: 1 },
  { key: 'in_brackets', pattern: '\\(([^)]*)\\)', group: 1 },
  { key: 'email_domain', pattern: '@([^\\s>]+)', group: 1 },
  { key: 'year', pattern: '((?:19|20)\\d{2})', group: 1 },
];

export const DATE_FORMAT_CHOICES = [
  '%Y-%m-%d',
  '%d/%m/%Y',
  '%m/%d/%Y',
  '%d-%m-%Y',
  '%d %b %Y',
  '%d-%b-%Y',
  '%b %d, %Y',
  '%d.%m.%Y',
  '%Y/%m/%d',
  '%Y-%m-%d %H:%M:%S',
];

/** Keep a step's label and on/off state when its settings are edited. */
export function withMeta(next: PrepStep, existing: PrepStep): PrepStep {
  const [, old] = stepParts(existing);
  const [kind, args] = stepParts(next);
  return { [kind]: { ...args, ...(old.note ? { note: old.note } : {}), ...(old.disabled ? { disabled: true } : {}) } };
}
