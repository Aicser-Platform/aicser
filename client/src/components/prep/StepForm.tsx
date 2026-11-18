// Ported from ../aicser/client/src/components/prep/StepForm.tsx @ 749d38d (see PORTING.md). UI rewritten; the
// form logic lives in lib/prep/stepForm.ts. No Predict / AI answer forms on desktop.
import { Plus, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { datePatterns, type PrepStep, type PreviewResult, type TypeSpec } from '@/api/prep';
import { Button } from '@/components/aicser-ui/button';
import { Checkbox } from '@/components/aicser-ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import { Input } from '@/components/aicser-ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { Textarea } from '@/components/aicser-ui/textarea';
import type { Condition } from '@/lib/prep/conditions';
import { tPrep as t } from '@/lib/prep/i18n';
import { convertName, renameAllMapping, stepColumns, type Convention } from '@/lib/prep/recipeSteps';
import {
  DATE_FORMAT_CHOICES,
  EXTRACT_PRESETS,
  NEEDS_ORDER,
  WINDOW_CALCS,
  buildStep,
  headerNames,
  initialValues,
  withMeta,
  type FormKind,
  type Values,
} from '@/lib/prep/stepForm';
import { cn } from '@/lib/ui/utils';
import { useProjectStore } from '@/stores/useProjectStore';
import { fetchApi } from '@/utils/api';
import { ConditionBuilder } from './ConditionBuilder';
import { Chip, ColumnMulti, ColumnSelect, FormRow, Segmented, Tag } from './controls';
import { FormulaEditor } from './FormulaEditor';

const AGGS = ['sum', 'count', 'avg', 'min', 'max'] as const;

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: {
  label: string;
  value: unknown;
  onChange: (n: number | '') => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span>{label}</span>
      <Input
        type="number"
        className="h-8 w-24"
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        value={value === '' || value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    </label>
  );
}

/** Before → after names, editable (rename all, header rows). */
function NameTable({
  names,
  empty,
  onChange,
}: {
  names: Record<string, string>;
  empty?: string;
  onChange: (from: string, to: string) => void;
}) {
  const rows = Object.entries(names);
  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted text-left">
          <tr>
            <th className="px-2 py-1 font-medium">{t('col_before')}</th>
            <th className="px-2 py-1 font-medium">{t('col_after')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([from, to]) => (
            <tr key={from} className="border-t">
              <td className="px-2 py-1">{from}</td>
              <td className="px-2 py-1">
                <Input className="h-7" value={to} aria-label={from} onChange={(e) => onChange(from, e.target.value)} />
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={2} className="px-2 py-3 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type AiChoice = { value: string; label: string; ready: boolean };

/** Web: approved prediction models, or AI decisions, the recipe's project can use (Predict / AI answer steps). */
function useAiChoices(kind: FormKind): AiChoice[] | null {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [choices, setChoices] = useState<AiChoice[] | null>(null);
  useEffect(() => {
    if (kind !== 'predict' && kind !== 'ai_answer') return;
    const qs = projectId ? `?project_id=${encodeURIComponent(String(projectId))}` : '';
    const load =
      kind === 'predict'
        ? fetchApi<{ items?: { id: string; name: string; task: string; production?: unknown }[] }>(`/api/models${qs}`).then(
            (r) =>
              (r.items ?? [])
                .filter((m) => m.task !== 'forecast')
                .map((m) => ({ value: m.id, label: m.name, ready: Boolean(m.production) }))
          )
        : fetchApi<{ definitions?: { id: string; name: string }[] }>(`/api/ai-decisions/definitions${qs}`).then((r) =>
            (r.definitions ?? []).map((d) => ({ value: d.id, label: d.name, ready: true }))
          );
    load.then(setChoices).catch(() => setChoices([]));
  }, [kind, projectId]);
  return choices;
}

export function StepForm({
  kind,
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
  const aiChoices = useAiChoices(kind);
  const [v, setV] = useState<Values>(() => {
    const init = initialValues(kind, columns, selected, existing, detected);
    // Split into rows: look at the column's values to choose a JSON list or a delimiter, so the common case needs
    // no setting at all.
    if (kind === 'split_rows' && init.format === 'auto') {
      const values = before
        .map((r) => String(r[init.column] ?? '').trim())
        .filter(Boolean)
        .slice(0, 50);
      if (values.length && values.every((x) => x.startsWith('[') && x.endsWith(']')))
        return { ...init, format: 'json' };
      const best = [';', '|', ',', '\n']
        .map((d) => [d, values.filter((x) => x.includes(d)).length] as const)
        .sort((a, b) => b[1] - a[1])[0];
      return { ...init, format: 'text', delimiter: best && best[1] ? best[0] : ',' };
    }
    return init;
  });
  const [draftState, setDraftState] = useState<PreviewResult | null>(null);
  const [draftErrorState, setDraftErrorState] = useState<string | null>(null);
  const [formulaOk, setFormulaOk] = useState(true);
  const set = (patch: Values) => setV((cur) => ({ ...cur, ...patch }));
  const step = useMemo(() => buildStep(kind, v, columns), [kind, v, columns]);
  const ready = Boolean(step) && (kind !== 'formula' || formulaOk);
  const stepKey = JSON.stringify(step);

  useEffect(() => {
    if (!step || (kind === 'formula' && !formulaOk)) return undefined;
    let cancelled = false;
    const handle = setTimeout(() => {
      runDraft(step)
        .then((res) => {
          if (cancelled) return;
          setDraftState(res);
          setDraftErrorState(res.step_errors[0]?.message ?? null);
        })
        .catch((err: unknown) => {
          if (!cancelled) setDraftErrorState(err instanceof Error ? err.message : String(err));
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // `step` is rebuilt every render; its JSON says when it really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on stepKey
  }, [stepKey, formulaOk, kind]);

  const multi = (field: string, label: string, min = 1) => (
    <FormRow label={label}>
      <ColumnMulti
        label={label}
        value={v[field]}
        options={columns}
        min={min}
        onChange={(val) => set({ [field]: val })}
      />
    </FormRow>
  );
  const single = (
    field: string,
    label: string,
    opts: { allowEmpty?: boolean; warn?: boolean; options?: string[] } = {}
  ) => (
    <FormRow label={label}>
      <ColumnSelect
        label={label}
        value={v[field]}
        options={opts.options ?? columns}
        allowEmpty={opts.allowEmpty}
        warn={opts.warn}
        onChange={(val) => set({ [field]: val })}
      />
    </FormRow>
  );
  const text = (field: string, label: string, placeholder?: string, hint?: string) => (
    <FormRow label={label} hint={hint}>
      <Input
        value={v[field] ?? ''}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => set({ [field]: e.target.value })}
      />
    </FormRow>
  );
  const choice = <T extends string>(field: string, label: string, options: { value: T; label: ReactNode }[]) => (
    <Segmented label={label} value={v[field] as T} options={options} onChange={(val) => set({ [field]: val })} />
  );
  const pairRows = (field: string, render: (pair: string[], i: number, setPair: (p: string[]) => void) => ReactNode) =>
    (v[field] as string[][]).map((pair, i) => (
      <div key={i} className="flex items-center gap-2">
        {render(pair, i, (p) => set({ [field]: v[field].map((x: string[], j: number) => (j === i ? p : x)) }))}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('remove_pair')}
          disabled={v[field].length === 1}
          onClick={() => set({ [field]: v[field].filter((_: unknown, j: number) => j !== i) })}
        >
          <Trash2 />
        </Button>
      </div>
    ));

  const addFromExample = async () => {
    try {
      const found = await datePatterns(v.example);
      if (found[0]) set({ formats: Array.from(new Set([...v.formats, found[0]])), example: '' });
      else set({ exampleMiss: true });
    } catch {
      set({ exampleMiss: true });
    }
  };

  const body = (() => {
    switch (kind) {
      case 'rename':
        return text('to', t('field_new_name'));
      case 'rename_all': {
        const mapping: Record<string, string> | null = v.mapping ?? renameAllMapping(columns, v.convention);
        return (
          <>
            {!v.mapping &&
              choice<Convention>(
                'convention',
                t('form_rename_all'),
                (['snake', 'title', 'camel', 'lower', 'upper'] as Convention[]).map((c) => ({
                  value: c,
                  label: convertName('Student ID', c),
                }))
              )}
            {mapping === null && <p className="text-sm text-(--layer-bronze)">{t('rename_collision')}</p>}
            <NameTable
              names={mapping ?? {}}
              empty={t('rename_nothing')}
              onChange={(from, to) => set({ mapping: { ...(mapping ?? {}), [from]: to } })}
            />
          </>
        );
      }
      case 'type_date':
        return (
          <>
            {multi('columns', t('field_columns'))}
            <FormRow label={t('field_date_formats')} hint={t('field_date_formats_hint')}>
              <div className="flex flex-wrap gap-1">
                {Array.from(new Set([...DATE_FORMAT_CHOICES, ...(v.formats as string[])])).map((f) => (
                  <Chip
                    key={f}
                    checked={(v.formats as string[]).includes(f)}
                    onClick={() =>
                      set({
                        formats: (v.formats as string[]).includes(f)
                          ? v.formats.filter((x: string) => x !== f)
                          : [...v.formats, f],
                      })
                    }
                  >
                    <span className="font-mono">{f}</span>
                  </Chip>
                ))}
              </div>
            </FormRow>
            <div className="flex gap-2">
              <Input
                value={v.example}
                onChange={(e) => set({ example: e.target.value, exampleMiss: false })}
                placeholder={t('date_example_placeholder')}
                aria-label={t('date_example')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void addFromExample();
                  }
                }}
              />
              <Button variant="outline" onClick={() => void addFromExample()} disabled={!v.example?.trim()}>
                {t('date_example_add')}
              </Button>
            </div>
            {v.exampleMiss && <p className="text-sm text-(--layer-bronze)">{t('date_example_miss')}</p>}
            {detected?.ambiguous && <p className="text-sm text-muted-foreground">{t('date_ambiguous')}</p>}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={Boolean(v.withTime)} onCheckedChange={(c) => set({ withTime: c === true })} />
              {t('date_with_time')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={Boolean(v.excel)} onCheckedChange={(c) => set({ excel: c === true })} />
              {t('date_excel_serial')}
            </label>
          </>
        );
      case 'type_number':
        return (
          <>
            {multi('columns', t('field_columns'))}
            {choice('type', t('action_change_type'), [
              { value: 'number', label: t('type_number') },
              { value: 'integer', label: t('type_integer') },
              { value: 'decimal', label: t('type_decimal') },
            ])}
            {choice('locale', t('number_hint'), [
              { value: 'us', label: t('locale_us') },
              { value: 'eu', label: t('locale_eu') },
            ])}
            <p className="text-xs text-muted-foreground">{t('number_hint')}</p>
          </>
        );
      case 'replace':
        return (
          <>
            {multi('columns', t('field_columns'))}
            {choice('match', t('field_find'), [
              { value: 'contains', label: t('match_contains') },
              { value: 'whole', label: t('match_whole') },
              { value: 'regex', label: t('match_regex') },
            ])}
            {pairRows('pairs', ([find = '', rep = ''], _i, setPair) => (
              <>
                <Input
                  value={find}
                  placeholder={v.match === 'regex' ? '\\s+' : t('field_find')}
                  aria-label={t('field_find')}
                  onChange={(e) => setPair([e.target.value, rep])}
                />
                <span className="text-muted-foreground">→</span>
                <Input
                  value={rep}
                  placeholder={t('field_replace_with')}
                  aria-label={t('field_replace_with')}
                  onChange={(e) => setPair([find, e.target.value])}
                />
              </>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => set({ pairs: [...v.pairs, ['', '']] })}
            >
              <Plus /> {t('add_pair')}
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={Boolean(v.caseSensitive)}
                onCheckedChange={(c) => set({ caseSensitive: c === true })}
              />
              {t('match_case')}
            </label>
          </>
        );
      case 'fill':
        return (
          <>
            {multi('columns', t('field_columns'))}
            {choice(
              'strategy',
              t('action_fill'),
              ['value', 'down', 'up', 'mean', 'median', 'mode'].map((s) => ({ value: s, label: t(`fill_${s}`) }))
            )}
            {v.strategy === 'value' && text('value', t('field_fill_value'), '0', t('field_fill_value_hint'))}
          </>
        );
      case 'split':
        return (
          <>
            {single('column', t('field_column'))}
            {choice('mode', t('action_split'), [
              { value: 'whitespace', label: t('split_whitespace') },
              { value: 'delimiter', label: t('split_delimiter') },
              { value: 'positions', label: t('split_positions') },
              { value: 'rows', label: t('split_rows') },
            ])}
            {(v.mode === 'delimiter' || v.mode === 'rows') && (
              <div className="flex flex-wrap items-center gap-1">
                {[',', ';', '-', '/', '|', ' '].map((d) => (
                  <Chip key={d} checked={v.delimiter === d} onClick={() => set({ delimiter: d })}>
                    {d === ' ' ? t('delimiter_space') : d}
                  </Chip>
                ))}
                <Input
                  className="h-7 w-28"
                  value={v.delimiter}
                  onChange={(e) => set({ delimiter: e.target.value })}
                  aria-label={t('field_delimiter')}
                  placeholder={t('delimiter_custom')}
                />
              </div>
            )}
            {v.mode === 'positions' && text('positions', t('field_positions'), '3, 7', t('field_positions_hint'))}
            {v.mode !== 'rows' && (
              <>
                {v.mode !== 'positions' && (
                  <NumberField
                    label={t('field_parts')}
                    min={2}
                    max={20}
                    value={v.parts}
                    onChange={(n) => set({ parts: n || 2 })}
                  />
                )}
                {text('into', t('field_new_columns'), 'first_name, last_name', t('split_names_hint'))}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={Boolean(v.keep)} onCheckedChange={(c) => set({ keep: c === true })} />
                  {t('keep_original')}
                </label>
              </>
            )}
          </>
        );
      case 'extract':
        return (
          <>
            {single('column', t('field_column'))}
            <div className="flex flex-wrap gap-1">
              {EXTRACT_PRESETS.map((p) => (
                <Chip
                  key={p.key}
                  checked={v.pattern === p.pattern}
                  onClick={() => set({ pattern: p.pattern, group: p.group })}
                >
                  {t(`extract_${p.key}`)}
                </Chip>
              ))}
            </div>
            {text('pattern', t('field_pattern'), '(\\d+)', t('field_pattern_hint'))}
            {text('into', t('field_new_column'))}
          </>
        );
      case 'mask':
        return (
          <>
            {multi('columns', t('field_columns'))}
            {choice(
              'method',
              t('action_mask'),
              (['hash', 'last4', 'redact'] as const).map((m) => ({ value: m, label: t(`mask_${m}`) }))
            )}
          </>
        );
      case 'change_case':
        return (
          <>
            {multi('columns', t('field_columns'))}
            {choice('case', t('action_case'), [
              { value: 'upper', label: 'UPPER' },
              { value: 'lower', label: 'lower' },
              { value: 'title', label: 'Title Case' },
              { value: 'sentence', label: 'Sentence case' },
            ])}
          </>
        );
      case 'filter_rows':
        return (
          <>
            {choice('action', t('action_filter'), [
              { value: 'keep', label: t('filter_keep') },
              { value: 'remove', label: t('filter_remove') },
            ])}
            <ConditionBuilder
              columns={columns}
              value={v.conditions}
              onChange={(c) => set({ conditions: c })}
              match={v.match}
              onMatchChange={(m) => set({ match: m })}
            />
          </>
        );
      case 'conditional': {
        type Rule = { conditions: Condition[]; match: 'all' | 'any'; then: { value?: string } };
        const rules = v.rules as Rule[];
        const setRule = (i: number, patch: Partial<Rule>) =>
          set({ rules: rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
        return (
          <>
            {text(
              'into',
              t('field_new_column'),
              'category',
              columns.includes(v.into) ? t('replaces_column') : undefined
            )}
            {rules.map((rule, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
                <p className="text-sm font-medium">{i === 0 ? t('rule_if') : t('rule_else_if')}</p>
                <ConditionBuilder
                  columns={columns}
                  value={rule.conditions}
                  match={rule.match}
                  onMatchChange={(m) => setRule(i, { match: m })}
                  onChange={(c) => setRule(i, { conditions: c })}
                />
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t('rule_then')}</span>
                  <Input
                    className="h-8"
                    value={rule.then?.value ?? ''}
                    placeholder={t('placeholder_value')}
                    aria-label={t('rule_then')}
                    onChange={(e) => setRule(i, { then: { value: e.target.value } })}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('remove_rule')}
                    disabled={rules.length === 1}
                    onClick={() => set({ rules: rules.filter((_, j) => j !== i) })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() =>
                set({
                  rules: [
                    ...rules,
                    {
                      conditions: [{ column: columns[0] ?? '', op: 'equals', value: '' }],
                      match: 'all',
                      then: { value: '' },
                    },
                  ],
                })
              }
            >
              <Plus /> {t('add_rule')}
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{t('rule_otherwise')}</span>
              <Input
                className="h-8"
                value={v.otherwise?.value ?? ''}
                placeholder={t('placeholder_otherwise')}
                aria-label={t('rule_otherwise')}
                onChange={(e) => set({ otherwise: { value: e.target.value } })}
              />
            </div>
          </>
        );
      }
      case 'formula':
        return (
          <>
            {text(
              'into',
              t('field_new_column'),
              'new_column',
              columns.includes(v.into) ? t('replaces_column') : undefined
            )}
            <FormulaEditor
              value={v.expression}
              language={v.language}
              onChange={(e) => set({ expression: e })}
              onLanguageChange={(l) => set({ language: l })}
              columns={columns}
              onValidity={setFormulaOk}
            />
          </>
        );
      case 'concat':
        return (
          <>
            {multi('columns', t('field_columns_in_order'), 2)}
            {text('separator', t('field_separator'), ' ')}
            {text('into', t('field_new_column'))}
          </>
        );
      case 'sql':
        return (
          <FormRow hint={t('sql_step_hint')}>
            <Textarea
              value={v.query}
              rows={8}
              className="font-mono text-xs"
              onChange={(e) => set({ query: e.target.value })}
              aria-label={t('form_sql')}
              spellCheck={false}
            />
          </FormRow>
        );
      case 'flatten_json':
        return (
          <>
            {single('column', t('field_column'))}
            {text('fields', t('field_json_fields'), 'city, address.country', t('flatten_hint'))}
          </>
        );
      case 'dedupe':
        return (
          <>
            {multi('columns', t('field_dedupe_columns'), 0)}
            <p className="text-xs text-muted-foreground">{t('dedupe_hint')}</p>
          </>
        );
      case 'group':
        return (
          <>
            {multi('by', t('field_group_by'), 0)}
            {AGGS.map((m) => (
              <Fragment key={m}>{multi(m, t(`agg_${m}`), 0)}</Fragment>
            ))}
          </>
        );
      case 'checks':
        return (
          <>
            {multi('notNull', t('check_not_null'), 0)}
            {multi('unique', t('check_unique'), 0)}
            <div className="grid grid-cols-2 gap-2">
              <ColumnSelect
                label={t('check_allowed_column')}
                placeholder={t('check_allowed_column')}
                allowEmpty
                value={v.acceptedColumn}
                options={columns}
                onChange={(val) => set({ acceptedColumn: val })}
              />
              <Input
                value={v.acceptedValues}
                placeholder={t('placeholder_in_list')}
                aria-label={t('check_allowed_values')}
                onChange={(e) => set({ acceptedValues: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ColumnSelect
                className="w-48"
                label={t('check_range_column')}
                placeholder={t('check_range_column')}
                allowEmpty
                value={v.rangeColumn}
                options={columns}
                onChange={(val) => set({ rangeColumn: val })}
              />
              <NumberField
                label={t('check_min')}
                placeholder="0"
                value={v.rangeMin}
                onChange={(n) => set({ rangeMin: n })}
              />
              <NumberField
                label={t('check_max')}
                placeholder="100"
                value={v.rangeMax}
                onChange={(n) => set({ rangeMax: n })}
              />
            </div>
            {choice('onFail', t('check_set_aside'), [
              { value: 'quarantine', label: t('check_set_aside') },
              { value: 'warn', label: t('check_warn') },
              { value: 'fail', label: t('check_fail') },
            ])}
          </>
        );
      case 'pivot':
        return (
          <>
            {single('on', t('field_pivot_on'))}
            {single('using', t('field_pivot_values'))}
            {choice(
              'agg',
              t('field_pivot_values'),
              AGGS.map((m) => ({ value: m, label: t(`agg_${m}`) }))
            )}
            {multi('groupBy', t('field_group_by'), 0)}
          </>
        );
      case 'merge':
        return (
          <>
            {single('asset', t('field_other_table'), { options: tables })}
            {choice('how', t('action_merge'), [
              { value: 'left', label: t('merge_left') },
              { value: 'inner', label: t('merge_inner') },
              { value: 'full', label: t('merge_full') },
            ])}
            <p className="text-sm font-medium">{t('merge_match')}</p>
            {pairRows('pairs', ([l = '', r = ''], _i, setPair) => (
              <>
                <ColumnSelect
                  label={t('merge_this_column')}
                  placeholder={t('merge_this_column')}
                  value={l || undefined}
                  options={columns}
                  onChange={(val) => setPair([val ?? '', r])}
                />
                <span className="text-muted-foreground">=</span>
                <Input
                  value={r}
                  placeholder={t('merge_other_column')}
                  aria-label={t('merge_other_column')}
                  onChange={(e) => setPair([l, e.target.value])}
                />
              </>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => set({ pairs: [...v.pairs, ['', '']] })}
            >
              <Plus /> {t('add_pair')}
            </Button>
            {choice('match', t('merge_match'), [
              { value: 'exact', label: t('merge_exact') },
              { value: 'similar', label: t('merge_similar') },
            ])}
            {v.match === 'similar' && (
              <FormRow hint={t('merge_similar_hint')}>
                <NumberField
                  label={t('merge_similarity')}
                  min={0.5}
                  max={1}
                  step={0.05}
                  value={v.threshold}
                  onChange={(n) => set({ threshold: n === '' ? 0.9 : n })}
                />
              </FormRow>
            )}
          </>
        );
      case 'window':
        return (
          <>
            <FormRow label={t('field_calculation')}>
              <NativeSelect
                aria-label={t('field_calculation')}
                className="w-full"
                value={v.calc}
                onChange={(e) => set({ calc: e.target.value })}
              >
                {WINDOW_CALCS.map((c) => (
                  <NativeSelectOption key={c} value={c}>
                    {t(`calc_${c}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormRow>
            {v.calc !== 'row_number' && single('column', t('field_value_column'))}
            <FormRow label={t('field_order_by')}>
              <div className="flex gap-2">
                <ColumnSelect
                  label={t('field_order_by')}
                  allowEmpty
                  warn={NEEDS_ORDER.has(v.calc) && !v.orderBy}
                  value={v.orderBy}
                  options={columns}
                  onChange={(val) => set({ orderBy: val })}
                />
                <NativeSelect
                  className="w-36"
                  aria-label={t('field_direction')}
                  value={v.descending ? 'desc' : 'asc'}
                  onChange={(e) => set({ descending: e.target.value === 'desc' })}
                >
                  <NativeSelectOption value="asc">{t('order_asc')}</NativeSelectOption>
                  <NativeSelectOption value="desc">{t('order_desc')}</NativeSelectOption>
                </NativeSelect>
              </div>
            </FormRow>
            {multi('partitionBy', t('field_per_group'), 0)}
            {v.calc === 'moving_average' && (
              <NumberField
                label={t('field_window_rows')}
                min={1}
                max={1000}
                value={v.size}
                onChange={(n) => set({ size: n || 3 })}
              />
            )}
            {(v.calc === 'previous' || v.calc === 'next') && (
              <NumberField
                label={t('field_rows_away')}
                min={1}
                max={1000}
                value={v.offset}
                onChange={(n) => set({ offset: n || 1 })}
              />
            )}
            {text('into', t('field_new_column'), `${v.calc}_${v.column ?? 'value'}`)}
          </>
        );
      case 'bin':
        return (
          <>
            {single('column', t('field_number_column'))}
            {choice('mode', t('action_bin'), [
              { value: 'edges', label: t('bin_edges') },
              { value: 'equal_width', label: t('bin_equal_width') },
              { value: 'quantiles', label: t('bin_quantiles') },
            ])}
            {v.mode === 'edges' ? (
              <>
                {text('edges', t('field_boundaries'), '10000, 50000', t('bin_edges_hint'))}
                {text('labels', t('field_range_labels'), t('bin_labels_placeholder'))}
              </>
            ) : (
              <NumberField
                label={t('field_range_count')}
                min={2}
                max={100}
                value={v.count}
                onChange={(n) => set({ count: n || 4 })}
              />
            )}
            {text('into', t('field_new_column'))}
          </>
        );
      case 'index':
        return (
          <>
            {text('into', t('field_new_column'))}
            <NumberField
              label={t('field_start_at')}
              value={v.start}
              onChange={(n) => set({ start: n === '' ? 1 : n })}
            />
            {multi('partitionBy', t('field_restart_per_group'), 0)}
            <FormRow label={t('field_order_by')}>
              <ColumnSelect
                label={t('field_order_by')}
                placeholder={t('index_keep_order')}
                allowEmpty
                value={v.orderBy}
                options={columns}
                onChange={(val) => set({ orderBy: val })}
              />
            </FormRow>
          </>
        );
      case 'top_n':
        return (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                label={t('action_top_n')}
                value={v.descending ? 'top' : 'bottom'}
                onChange={(val) => set({ descending: val === 'top' })}
                options={[
                  { value: 'top', label: t('topn_top') },
                  { value: 'bottom', label: t('topn_bottom') },
                ]}
              />
              <NumberField
                label={t('field_how_many')}
                min={1}
                max={100000}
                value={v.n}
                onChange={(n) => set({ n: n || 1 })}
              />
            </div>
            {single('orderBy', t('field_by_column'))}
            {multi('partitionBy', t('field_per_group'), 0)}
          </>
        );
      case 'remove_rows':
        return (
          <>
            <NumberField
              label={t('field_remove_top')}
              min={0}
              max={1000000}
              value={v.top}
              onChange={(n) => set({ top: n || 0 })}
            />
            <NumberField
              label={t('field_remove_bottom')}
              min={0}
              max={1000000}
              value={v.bottom}
              onChange={(n) => set({ bottom: n || 0 })}
            />
            <p className="text-xs text-muted-foreground">{t('remove_rows_hint')}</p>
          </>
        );
      case 'header_rows': {
        const names: Record<string, string> =
          v.names ??
          headerNames(
            before.slice(Number(v.skip) || 0, (Number(v.skip) || 0) + (Number(v.rows) || 1)),
            columns,
            v.joiner ?? ' '
          );
        const regen = (patch: Values) => {
          const next = { ...v, ...patch };
          const skip = Number(next.skip) || 0;
          set({
            ...patch,
            names: headerNames(before.slice(skip, skip + (Number(next.rows) || 1)), columns, next.joiner ?? ' '),
          });
        };
        return (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <NumberField
                label={t('field_rows_above')}
                min={0}
                max={100}
                value={v.skip}
                onChange={(n) => regen({ skip: n || 0 })}
              />
              <NumberField
                label={t('field_header_rows')}
                min={1}
                max={10}
                value={v.rows}
                onChange={(n) => regen({ rows: n || 1 })}
              />
              {Number(v.rows) > 1 && (
                <label className="flex items-center gap-2 text-sm">
                  {t('field_joined_with')}
                  <Input className="h-8 w-16" value={v.joiner} onChange={(e) => regen({ joiner: e.target.value })} />
                </label>
              )}
            </div>
            <NameTable names={names} onChange={(from, to) => set({ names: { ...names, [from]: to } })} />
          </>
        );
      }
      case 'split_rows':
        return (
          <>
            <Segmented
              label={t('action_split_rows')}
              value={v.format === 'json' ? 'json' : 'text'}
              onChange={(val) => set({ format: val })}
              options={[
                { value: 'text', label: t('rows_from_text') },
                { value: 'json', label: t('rows_from_json') },
              ]}
            />
            {v.format !== 'json' && text('delimiter', t('field_delimiter'), ',')}
            <p className="text-xs text-muted-foreground">{t('split_rows_hint')}</p>
          </>
        );
      case 'expand_rows':
        return (
          <>
            {multi('columns', t('field_list_columns'))}
            {choice('format', t('action_expand_rows'), [
              { value: 'json', label: t('rows_from_json') },
              { value: 'text', label: t('rows_from_text') },
            ])}
            {v.format === 'text' && text('delimiter', t('field_delimiter'), ',')}
            <p className="text-xs text-muted-foreground">{t('expand_rows_hint')}</p>
          </>
        );
      case 'append':
        return (
          <>
            {single('asset', t('field_other_table'), { options: tables })}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={Boolean(v.all)} onCheckedChange={(c) => set({ all: c === true })} />
              {t('append_keep_duplicates')}
            </label>
            <p className="text-xs text-muted-foreground">{t('append_hint')}</p>
          </>
        );
      case 'predict':
      case 'ai_answer': {
        const isPredict = kind === 'predict';
        const field = isPredict ? 'model_id' : 'decision_id';
        const label = isPredict ? t('field_model') : t('field_decision');
        return (
          <>
            <FormRow label={label}>
              <NativeSelect
                aria-label={label}
                className="w-full"
                value={v[field] ?? ''}
                onChange={(e) => set({ [field]: e.target.value })}
              >
                <NativeSelectOption value="">{aiChoices === null ? '…' : '—'}</NativeSelectOption>
                {(aiChoices ?? []).map((c) => (
                  <NativeSelectOption key={c.value} value={c.value} disabled={!c.ready}>
                    {c.ready ? c.label : `${c.label} · ${t('predict_not_approved')}`}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {aiChoices !== null && !aiChoices.length ? (
                <p className="text-xs text-muted-foreground">{isPredict ? t('predict_none') : t('ai_answer_none')}</p>
              ) : null}
            </FormRow>
            {isPredict ? null : multi('columns', t('field_ai_columns'))}
            {text(
              'into',
              t('field_output_column'),
              isPredict ? t('placeholder_predict_column') : t('placeholder_ai_column'),
              isPredict ? t('predict_hint') : t('ai_answer_hint')
            )}
          </>
        );
      }
      case 'unpivot':
        return (
          <>
            {multi('columns', t('field_unpivot_columns'))}
            {text('name', t('field_unpivot_name'), 'attribute')}
            {text('value', t('field_unpivot_value'), 'value')}
          </>
        );
    }
  })();

  // A stale preview from an earlier, now-incomplete form is not shown.
  const draft = ready ? draftState : null;
  const draftError = ready ? draftErrorState : null;
  // Before → after for the columns this step touches (or adds), on the first rows.
  const touched = step ? stepColumns(step) : [];
  const added = draft?.columns.map((c) => c.name).filter((c) => !columns.includes(c)) ?? [];
  const shown = Array.from(
    new Set([...touched.filter((c) => draft?.columns.some((d) => d.name === c)), ...added])
  ).slice(0, 4);
  const last = draft?.step_stats?.[draft.step_stats.length - 1];
  // Row-by-row before/after only makes sense when the step keeps every row in place.
  const aligned = Boolean(draft) && !last?.rows_delta;
  const previewRows = (draft?.rows ?? [])
    .slice(0, 8)
    .map((row, i) => ({ before: aligned ? before[i] : undefined, after: row }));
  const wide = kind === 'formula' || kind === 'conditional' || kind === 'rename_all';

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className={cn('max-h-[90vh] overflow-y-auto', wide ? 'sm:max-w-3xl' : 'sm:max-w-xl')}>
        <DialogHeader>
          <DialogTitle>{t(`form_${kind}`, { column: selected[0] ?? '' })}</DialogTitle>
          <DialogDescription className="sr-only">{t('draft_fill_form')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">{body}</div>
        <section aria-label={t('draft_preview')} className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
          <p className="text-sm font-medium">{t('draft_preview')}</p>
          {draftError && (
            <p role="alert" className="text-sm text-destructive">
              {draftError}
            </p>
          )}
          {last && !draftError && (
            <div className="flex flex-wrap gap-1">
              {last.rows_delta ? <Tag tone="warn">{t('stat_rows', { delta: last.rows_delta })}</Tag> : null}
              {last.added?.length ? <Tag tone="good">{t('stat_added', { count: last.added.length })}</Tag> : null}
              {last.removed?.length ? <Tag>{t('stat_removed', { count: last.removed.length })}</Tag> : null}
              {Object.entries(last.emptied ?? {}).map(([c, n]) => (
                <Tag key={c} tone="bad">
                  {t('stat_emptied', { count: n, column: c })}
                </Tag>
              ))}
              {!last.rows_delta &&
              !last.added?.length &&
              !last.removed?.length &&
              !Object.keys(last.emptied ?? {}).length ? (
                <Tag tone="good">{t('stat_clean')}</Tag>
              ) : null}
            </div>
          )}
          {draft && shown.length ? (
            <div className="overflow-x-auto rounded border bg-card">
              <table className="w-full text-xs">
                <thead className="bg-muted text-left">
                  <tr>
                    {shown.map((c) => (
                      <th key={c} className="px-2 py-1 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i} className="border-t">
                      {shown.map((c) => {
                        const b = r.before?.[c];
                        const a = r.after[c];
                        const changed = String(b ?? '') !== String(a ?? '');
                        return (
                          <td key={c} className={cn('px-2 py-1 whitespace-nowrap', changed && 'bg-primary/10')}>
                            {changed && b !== undefined && (
                              <>
                                <del className="text-muted-foreground">{String(b ?? '')}</del> →{' '}
                              </>
                            )}
                            {a === null || a === undefined ? (
                              <em className="text-muted-foreground">{t('empty_cell')}</em>
                            ) : (
                              String(typeof a === 'object' ? JSON.stringify(a) : a)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !draft && !draftError ? (
            <p className="text-sm text-muted-foreground">{step ? t('loading_preview') : t('draft_fill_form')}</p>
          ) : null}
        </section>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button
            disabled={!step || !ready || Boolean(draftError)}
            onClick={() => step && onSubmit(existing ? withMeta(step, existing) : step)}
          >
            {existing ? t('save_step') : t('add_step')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
