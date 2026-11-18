// Ported from ../aicser/client/src/components/prep/RecipeEditor.tsx @ 749d38d (see PORTING.md). UI rewritten
// (AntD Table/Dropdown/Drawer/Modal → own grid, shadcn menus, sheet and dialog). Back on the web (desktop leaves them
// out): AI answer and Predict steps (Enterprise models / AI decisions), lake-table previews (pipeline wizard).
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Filter,
  FunctionSquare,
  Lightbulb,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Rows3,
  Search,
  Zap,
  FlaskConical,
} from 'lucide-react';
import { isEnterpriseEdition } from '@/utils/appPaths';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  detectTypes,
  failedValues,
  listSourceTables,
  previewSteps,
  profileSteps,
  type CleaningLog,
  type ColumnMeaning,
  type Finding,
  type PrepStep,
  type SampleMode,
  type TypeSpec,
} from '@/api/prep';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/aicser-ui/dropdown-menu';
import { Input } from '@/components/aicser-ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/aicser-ui/sheet';
import { decisionKey } from '@/lib/prep/clean';
import { tPrep as t, tRoles as tr, tRoot } from '@/lib/prep/i18n';
import {
  appendStep,
  COLUMN_TYPES,
  friendlyType,
  moveStep,
  steps as build,
  type ColumnType,
} from '@/lib/prep/recipeSteps';
import { formForStep, type FormKind } from '@/lib/prep/stepForm';
import { stepSentence, toggleDisabled } from '@/lib/prep/stepText';
import { cn } from '@/lib/ui/utils';
import { CleanPanel, type AugmentAction } from './CleanPanel';
import { ColumnHeader } from './ColumnHeader';
import { ColumnMeaningDialog } from './ColumnMeaningDialog';
import { Segmented, Tag } from './controls';
import { SqlView, YamlView } from './CodeViews';
import { MenuItems, type MenuEntry } from './menu';
import { StepForm } from './StepForm';
import { StepList } from './StepList';

export type RecipeEditorProps = {
  dataSourceId: string;
  table?: string | null;
  /** Web: preview against a loaded lake table (the pipeline wizard's bronze object) instead of the source. */
  lakeObjectId?: string | null;
  projectId?: string | null;
  steps: PrepStep[];
  onChange: (steps: PrepStep[]) => void;
  readOnly?: boolean;
  /** Column meaning (description, role, personal data); shown when the host can save it. */
  columnMeta?: Record<string, ColumnMeaning> | null;
  onColumnMetaChange?: (meta: Record<string, ColumnMeaning>) => Promise<void>;
  /** Names the cleaning report. */
  name?: string;
  /** The CLEAN panel's decisions and notes; saved when the host can. */
  cleaning?: CleaningLog | null;
  onCleaningChange?: (log: CleaningLog) => Promise<void>;
};

const PREVIEW_LIMIT = 200;
const PAGE = 100;
const SAMPLE_ROWS: Record<SampleMode, number> = { first: 1000, random: 10000, full: 100000 };

type FormState = { kind: FormKind; columns: string[]; editIndex?: number; detected?: TypeSpec } | null;

const cellText = (value: unknown) => String(typeof value === 'object' ? JSON.stringify(value) : value);

/**
 * Prepare's one editor: steps on the left, the data after the selected step in the middle, the CLEAN panel
 * (understand, fix, review, enrich, note) on the right. Every change shows what it did, can be edited, switched off
 * or undone.
 */
export function RecipeEditor({
  dataSourceId,
  lakeObjectId,
  table,
  projectId,
  steps,
  onChange,
  readOnly = false,
  columnMeta,
  onColumnMetaChange,
  name,
  cleaning,
  onCleaningChange,
}: RecipeEditorProps) {
  const [meaningFor, setMeaningFor] = useState<{ column: string; kind: string } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [selCols, setSelCols] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>(null);
  const [view, setView] = useState<'steps' | 'yaml' | 'sql'>('steps');
  const [sampleMode, setSampleMode] = useState<SampleMode>('first');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [failures, setFailures] = useState<{ step: number; column: string } | null>(null);
  const [detectOpen, setDetectOpen] = useState(false);
  const [detectPick, setDetectPick] = useState<string[]>([]);
  // Everything detected starts ticked; people untick what they disagree with.
  const [detectPicked, setDetectPicked] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1280);
  const [history, setHistory] = useState<{ past: PrepStep[][]; future: PrepStep[][] }>({ past: [], future: [] });

  const sample = { sample_mode: sampleMode, sample_rows: SAMPLE_ROWS[sampleMode] };
  const upTo = selected;
  const visibleSteps = useMemo(() => (upTo === null ? steps : steps.slice(0, upTo + 1)), [steps, upTo]);
  const base = { data_source_id: dataSourceId, table, lake_object_id: lakeObjectId ?? null };
  const key = [dataSourceId, table ?? null, lakeObjectId ?? null, projectId ?? null, sampleMode] as const;

  const commit = useCallback(
    (next: PrepStep[]) => {
      setHistory((h) => ({ past: [...h.past.slice(-49), steps], future: [] }));
      onChange(next);
    },
    [onChange, steps]
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
    if (readOnly) return undefined;
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

  const visibleKey = JSON.stringify(visibleSteps);
  const allKey = JSON.stringify(steps);
  const preview = useQuery({
    queryKey: ['prep', 'preview', ...key, visibleKey],
    queryFn: () => previewSteps({ ...base, steps: visibleSteps, limit: PREVIEW_LIMIT, ...sample }, projectId),
    placeholderData: (prev) => prev,
  });
  const fullStats = useQuery({
    queryKey: ['prep', 'stats', ...key, allKey],
    queryFn: () => previewSteps({ ...base, steps, limit: 1, ...sample }, projectId),
    enabled: upTo !== null,
    staleTime: 30_000,
  });
  const profile = useQuery({
    queryKey: ['prep', 'profile', ...key, visibleKey],
    queryFn: () => profileSteps({ ...base, steps: visibleSteps, ...sample }, projectId),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const detect = useQuery({
    queryKey: ['prep', 'detect', ...key, visibleKey],
    queryFn: () => detectTypes({ ...base, steps: visibleSteps, ...sample }, projectId),
    enabled: detectOpen || form?.kind === 'type_date' || form?.kind === 'type_number',
    staleTime: 60_000,
  });
  // Other tables of this connection, for Merge and Append.
  const otherTables = useQuery({
    queryKey: ['prep', 'tables', dataSourceId],
    queryFn: () => listSourceTables(dataSourceId),
    enabled: form?.kind === 'merge' || form?.kind === 'append',
    staleTime: 300_000,
  });
  const failureList = useQuery({
    queryKey: ['prep', 'failures', ...key, allKey, failures?.step, failures?.column],
    queryFn: () =>
      failedValues({ ...base, steps, ...sample, step: failures?.step ?? 0, column: failures?.column ?? '' }, projectId),
    enabled: Boolean(failures),
  });

  const stepErrors = preview.data?.step_errors ?? [];
  const errorAt = (i: number) => stepErrors.find((e) => e.step === i)?.message;
  const stats =
    (upTo === null ? preview.data?.step_stats : fullStats.data?.step_stats) ?? preview.data?.step_stats ?? [];
  const changes = preview.data?.changes;
  const columnNames = useMemo(() => (preview.data?.columns ?? []).map((c) => c.name), [preview.data?.columns]);
  const dists = profile.data?.distributions ?? {};
  const typeOf = (column: string) => friendlyType(preview.data?.columns.find((c) => c.name === column)?.type ?? '');

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
    const first = columns[0] ?? '';
    if (type === 'date' || type === 'datetime') {
      open('type_date', columns, detect.data?.columns[first] ?? { type, formats: [] });
      return;
    }
    if (type === 'number' || type === 'integer' || type === 'decimal') {
      open('type_number', columns, detect.data?.columns[first] ?? { type, locale: 'us' });
      return;
    }
    add(build.setType(columns, { type }));
  };

  const item = (
    key: string,
    label: string,
    onClick: () => void,
    extra: Partial<Extract<MenuEntry, { onClick: () => void }>> = {}
  ): MenuEntry => ({
    key,
    label,
    onClick,
    ...extra,
  });

  const columnMenu = (column: string): MenuEntry[] => {
    const cols = target(column);
    const many = cols.length > 1;
    return [
      ...(many
        ? ([
            { kind: 'label', key: 'count', label: t('applies_to', { count: cols.length }) },
            { kind: 'divider', key: 'd0' },
          ] as MenuEntry[])
        : []),
      ...(!many ? [item('rename', t('action_rename'), () => open('rename', [column]))] : []),
      ...(!many && onColumnMetaChange
        ? [item('meaning', t('action_meaning'), () => setMeaningFor({ column, kind: typeOf(column) }))]
        : []),
      {
        kind: 'sub',
        key: 'type',
        label: t('action_change_type'),
        children: [
          ...COLUMN_TYPES.map((type) => item(`type-${type}`, t(`type_${type}`), () => setType(cols, type))),
          // Category is how a column is used, not how it is stored: it groups rows by its values.
          ...(onColumnMetaChange
            ? ([
                { kind: 'divider', key: 'd-type' },
                item(
                  'type-category',
                  tr('use_as_category'),
                  () =>
                    void onColumnMetaChange({
                      ...(columnMeta ?? {}),
                      ...Object.fromEntries(
                        cols.map((c) => [c, { ...(columnMeta?.[c] ?? {}), role: 'category' as const }])
                      ),
                    }),
                  { title: tr('category_hint') }
                ),
              ] as MenuEntry[])
            : []),
        ],
      },
      {
        kind: 'sub',
        key: 'clean',
        label: t('group_clean'),
        children: [
          item('trim', t('action_trim'), () => add(build.trim(cols))),
          item('empty', t('action_empty_markers'), () => add(build.emptyMarkers(cols))),
          item('case', t('action_case'), () => open('change_case', cols)),
          item('currency', t('action_strip_currency'), () => add(build.stripCurrency(cols))),
          item('replace', t('action_replace'), () => open('replace', cols)),
          item('fill', t('action_fill'), () => open('fill', cols)),
          item('mask', t('action_mask'), () => open('mask', cols)),
        ],
      },
      ...(!many
        ? ([
            {
              kind: 'sub',
              key: 'transform',
              label: t('group_transform'),
              children: [
                item('split', t('action_split'), () => open('split', [column])),
                item('extract', t('action_extract'), () => open('extract', [column])),
                item('flatten', t('action_flatten_json'), () => open('flatten_json', [column])),
                item('split_rows', t('action_split_rows'), () => open('split_rows', [column])),
                item('window', t('action_window'), () => open('window', [column])),
                item('bin', t('action_bin'), () => open('bin', [column])),
              ],
            },
          ] as MenuEntry[])
        : [item('concat', t('action_concat'), () => open('concat', cols))]),
      {
        kind: 'sub',
        key: 'rows',
        label: t('group_rows'),
        children: [
          item('filter', t('action_filter'), () => open('filter_rows', cols)),
          item('not_empty', t('action_remove_empty_rows'), () => add(build.removeEmptyRows(cols))),
          item('dedupe', t('action_dedupe_by'), () => add(build.dedupeBy(cols))),
          ...(!many
            ? [
                item('top_n', t('action_top_n'), () => open('top_n', [column])),
                item('sort_asc', t('action_sort_asc'), () => add(build.sort(column, false))),
                item('sort_desc', t('action_sort_desc'), () => add(build.sort(column, true))),
              ]
            : []),
        ],
      },
      { kind: 'divider', key: 'd1' },
      item('keep', t('action_keep_only'), () => add(build.keepOnly(cols))),
      item(
        'remove',
        many ? t('action_remove_columns', { count: cols.length }) : t('action_remove_column'),
        () => add(build.remove(cols)),
        { danger: true }
      ),
    ];
  };

  const addMenu: MenuEntry[] = [
    item('formula', t('add_formula'), () => open('formula', selCols), { icon: <FunctionSquare /> }),
    item('conditional', t('add_conditional'), () => open('conditional', selCols)),
    item('concat', t('action_concat'), () => open('concat', selCols)),
  ];
  const tableMenu: MenuEntry[] = [
    {
      kind: 'sub',
      key: 'sheet',
      label: t('group_sheet'),
      children: [
        item('header_rows', t('action_header_rows'), () => open('header_rows', [])),
        item('remove_rows', t('action_remove_rows'), () => open('remove_rows', [])),
      ],
    },
    item('expand_rows', t('action_expand_rows'), () => open('expand_rows', selCols)),
    item('window', t('action_window'), () => open('window', selCols)),
    item('index', t('action_index'), () => open('index', [])),
    { kind: 'divider', key: 'd1' },
    item('checks', t('action_checks'), () => open('checks', selCols)),
    item('merge', t('action_merge'), () => open('merge', selCols)),
    item('append', t('action_append'), () => open('append', [])),
    item('pivot', t('action_pivot'), () => open('pivot', selCols)),
    { kind: 'divider', key: 'd2' },
    item('dedupe_rows', t('action_dedupe_rows'), () => add(build.dedupeRows())),
    item('rename_all', t('action_rename_all'), () => open('rename_all', [])),
    item('group', t('action_group'), () => open('group', selCols)),
    item('unpivot', t('action_unpivot'), () => open('unpivot', selCols)),
    { kind: 'divider', key: 'd3' },
    item('sql', t('action_sql'), () => open('sql', [])),
  ];

  const editStep = (i: number) => {
    const step = steps[i];
    const kind = step ? formForStep(step) : null;
    if (!kind) {
      setView('yaml');
      return;
    }
    setForm({ kind, columns: [], editIndex: i });
  };

  const changed = changes?.changed ?? {};
  const added = new Set(changes?.added ?? []);
  const q = search.trim().toLowerCase();
  const rows = (preview.data?.rows ?? []).map((r, i) => ({ i, r }));
  const filteredRows = q
    ? rows.filter(({ r }) =>
        Object.values(r).some((v) =>
          String(v ?? '')
            .toLowerCase()
            .includes(q)
        )
      )
    : rows;
  const pages = Math.max(1, Math.ceil(filteredRows.length / PAGE));
  const pageNow = Math.min(page, pages - 1);
  const pageRows = filteredRows.slice(pageNow * PAGE, pageNow * PAGE + PAGE);

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
    const fixes = findings.map((f) => f.suggested_step).filter((s): s is PrepStep => Boolean(s));
    if (!fixes.length) return;
    commit(fixes.reduce((acc, s) => appendStep(acc, s), steps));
    setSelected(null);
  };

  const health = profile.data?.health;
  const findingText = useCallback(
    (f: Finding) =>
      tRoot(
        f.message_key,
        Object.fromEntries(
          Object.entries(f.params).map(([k, v]) => [
            k,
            k === 'type' ? t(`type_${String(v)}`).toLowerCase() : Array.isArray(v) ? v.join(' → ') : String(v ?? ''),
          ])
        )
      ),
    []
  );
  const openIssues =
    findings.filter((f) => f.suggested_step).length +
    findings.filter((f) => !f.suggested_step && !cleaning?.decisions?.[decisionKey(f)]).length;
  const augment: AugmentAction[] = [
    { key: 'formula', icon: <FunctionSquare />, label: t('add_formula'), onClick: () => open('formula', selCols) },
    { key: 'conditional', label: t('add_conditional'), onClick: () => open('conditional', selCols) },
    { key: 'concat', label: t('action_concat'), onClick: () => open('concat', selCols) },
    { key: 'split', label: t('action_split'), needsColumn: true, onClick: () => open('split', selCols.slice(0, 1)) },
    {
      key: 'extract',
      label: t('action_extract'),
      needsColumn: true,
      onClick: () => open('extract', selCols.slice(0, 1)),
    },
    { key: 'merge', label: t('action_merge'), onClick: () => open('merge', selCols) },
    { key: 'append', label: t('action_append'), onClick: () => open('append', []) },
    { key: 'group', label: t('action_group'), onClick: () => open('group', selCols) },
    // Web (Enterprise): AI decisions and prediction models the project can use.
    ...(isEnterpriseEdition()
      ? [
          { key: 'ai_answer', icon: <Zap />, label: t('add_ai_answer'), onClick: () => open('ai_answer', selCols) },
          { key: 'predict', icon: <FlaskConical />, label: t('add_predict'), onClick: () => open('predict', selCols) },
        ]
      : []),
  ];
  const showColumn = (column: string) => {
    setSelCols([column]);
    requestAnimationFrame(() => {
      const th = Array.from(document.querySelectorAll<HTMLElement>('[data-prep-col]')).find(
        (el) => el.dataset.prepCol === column
      );
      th?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  };
  const failureStep = failures ? steps[failures.step] : undefined;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
      <StepList
        steps={steps}
        table={preview.data?.table || table || '…'}
        selected={selected}
        stats={stats}
        errorAt={errorAt}
        readOnly={readOnly}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onSelect={setSelected}
        onEdit={editStep}
        onToggle={(i) => {
          const step = steps[i];
          if (step) replaceAt(i, toggleDisabled(step));
        }}
        onMove={(i, d) => commit(moveStep(steps, i, d))}
        onRemove={(i) => {
          commit(steps.filter((_, idx) => idx !== i));
          setSelected(null);
        }}
        onUndo={undo}
        onRedo={redo}
        onShowFailures={(step, column) => setFailures({ step, column })}
      />

      <section aria-label={t('view_data')} className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm">
                    <Plus /> {t('add_column')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <MenuItems items={addMenu} />
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={() => open('filter_rows', selCols)}>
                <Filter /> {t('action_filter')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDetectPick([]);
                  setDetectPicked(false);
                  setDetectOpen(true);
                }}
              >
                <Zap /> {t('detect_types')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Rows3 /> {t('table_actions')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <MenuItems items={tableMenu} />
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-7 w-44 pl-7 text-xs"
              placeholder={t('search_rows')}
              aria-label={t('search_rows')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('clean.title')}
            title={t('clean.title')}
            aria-pressed={cleanOpen}
            onClick={() => setCleanOpen((o) => !o)}
          >
            {cleanOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>

        {selCols.length > 1 && !readOnly && (
          <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-sm">
            <span className="font-medium">{t('selected_columns', { count: selCols.length })}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="outline">
                  {t('actions')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <MenuItems items={columnMenu(selCols[0] ?? '')} />
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="xs" variant="ghost" onClick={() => setSelCols([])}>
              <Eraser /> {t('clear_selection')}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground" role="status">
            {preview.data
              ? t('preview_meta', {
                  rows: preview.data.rows.length,
                  columns: preview.data.columns.length,
                  sample: preview.data.sample_rows,
                  mode: t(`sample_label_${preview.data.sample_mode}`),
                })
              : t('loading_preview')}
          </span>
          {preview.isFetching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
          {preview.data?.sampled && <Tag tone="warn">{t('sample_partial')}</Tag>}
          {selected !== null && selected >= 0 && changes && (
            <span className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground">{t('this_step')}</span>
              {changedCount ? <Tag tone="info">{t('cells_changed', { count: changedCount })}</Tag> : null}
              {changes.added.length ? <Tag tone="good">{t('stat_added', { count: changes.added.length })}</Tag> : null}
              {removedCols.length ? (
                <Tag title={removedCols.join(', ')}>{t('stat_removed', { count: removedCols.length })}</Tag>
              ) : null}
            </span>
          )}
          {preview.data?.quarantined_count ? (
            <Tag tone="warn">{t('set_aside_count', { count: preview.data.quarantined_count })}</Tag>
          ) : null}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <NativeSelect
              size="sm"
              title={t('sample_hint')}
              aria-label={t('sample_hint')}
              value={sampleMode}
              onChange={(e) => setSampleMode(e.target.value as SampleMode)}
            >
              <NativeSelectOption value="first">{t('sample_first')}</NativeSelectOption>
              <NativeSelectOption value="random">{t('sample_random')}</NativeSelectOption>
              <NativeSelectOption value="full">{t('sample_full')}</NativeSelectOption>
            </NativeSelect>
            <Segmented
              size="xs"
              label={t('view_data')}
              value={view}
              onChange={setView}
              options={[
                { value: 'steps', label: t('view_data') },
                { value: 'yaml', label: t('view_yaml') },
                { value: 'sql', label: t('view_sql') },
              ]}
            />
          </span>
        </div>

        {view === 'yaml' ? (
          <YamlView
            key={allKey}
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
            {stepErrors[0] && (
              <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm">
                <p className="font-medium text-destructive">{t('step_failed', { step: stepErrors[0].step + 1 })}</p>
                <p>{stepErrors[0].message}</p>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              <table aria-label={t('view_data')} className="text-sm">
                <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--border)]">
                  <tr>
                    {(preview.data?.columns ?? []).map((col) => (
                      <th
                        key={col.name}
                        data-prep-col={col.name}
                        className={cn(
                          'border-r px-2 text-left align-top font-normal',
                          selCols.includes(col.name) && 'bg-primary/10',
                          added.has(col.name) && 'bg-(--status-good)/10'
                        )}
                      >
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
                                  : [col.name]
                            )
                          }
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(({ i, r }) => (
                    <tr key={i} className="border-t">
                      {(preview.data?.columns ?? []).map((col) => {
                        const value = r[col.name];
                        return (
                          <td
                            key={col.name}
                            className={cn(
                              'max-w-60 truncate border-r px-2 py-1',
                              changed[col.name]?.includes(i) && 'bg-primary/15',
                              added.has(col.name) && 'bg-(--status-good)/10',
                              selCols.includes(col.name) && 'bg-primary/5'
                            )}
                          >
                            {value === null || value === undefined ? (
                              <em className="text-muted-foreground">{t('empty_cell')}</em>
                            ) : (
                              cellText(value)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!pageRows.length && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {preview.isError
                    ? `${t('preview_error')} ${preview.error instanceof Error ? preview.error.message : ''}`
                    : preview.isLoading
                      ? t('loading_preview')
                      : t('no_rows')}
                </p>
              )}
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Previous page"
                  disabled={pageNow === 0}
                  onClick={() => setPage(pageNow - 1)}
                >
                  <ChevronLeft />
                </Button>
                {pageNow + 1} / {pages}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Next page"
                  disabled={pageNow >= pages - 1}
                  onClick={() => setPage(pageNow + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {cleanOpen && (
        <aside aria-label={t('clean.title')} className="flex w-80 shrink-0 flex-col border-l bg-card/40">
          <header className="flex items-center gap-2 border-b px-3 py-2">
            <Lightbulb className="size-4 text-primary" aria-hidden="true" />
            <h3 className="flex-1 text-sm font-semibold">
              {t('clean.title')}{' '}
              {openIssues ? <span className="font-normal text-muted-foreground">{openIssues}</span> : null}
            </h3>
            {health != null && (
              <Tag tone={health >= 80 ? 'good' : health >= 50 ? 'warn' : 'bad'}>{t('health', { score: health })}</Tag>
            )}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <CleanPanel
              name={name ?? table ?? ''}
              table={preview.data?.table || table || ''}
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
              stepSentences={steps.map((step) => stepSentence(step, t))}
              findingText={findingText}
              augment={augment}
              hasSelection={selCols.length > 0}
              onApply={(step) => add(step)}
              onApplyAll={applyAll}
              onSelectColumn={showColumn}
              onMeaning={onColumnMetaChange ? (column) => setMeaningFor({ column, kind: typeOf(column) }) : undefined}
              onExclude={(column) => open('filter_rows', [column])}
            />
          </div>
        </aside>
      )}

      {form && (
        <StepForm
          key={`${form.kind}-${form.editIndex ?? 'new'}`}
          kind={form.kind}
          columns={columnNames}
          selected={form.columns}
          existing={form.editIndex !== undefined ? steps[form.editIndex] : undefined}
          detected={form.detected ?? (form.columns[0] ? detect.data?.columns[form.columns[0]] : undefined)}
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
      )}

      <Dialog open={detectOpen} onOpenChange={setDetectOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('detect_types')}</DialogTitle>
            <DialogDescription>
              {detect.isFetching ? t('checking_data') : detected.length === 0 ? t('detect_nothing') : t('detected_as')}
            </DialogDescription>
          </DialogHeader>
          {detected.length > 0 && (
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="w-8 px-2 py-1">
                      <Checkbox
                        aria-label={t('select_all')}
                        checked={picked.length === detected.length}
                        onCheckedChange={(c) => pick(c === true ? detected.map(([col]) => col) : [])}
                      />
                    </th>
                    <th className="px-2 py-1 font-medium">{t('field_column')}</th>
                    <th className="px-2 py-1 font-medium">{t('detected_as')}</th>
                    <th className="px-2 py-1 font-medium">{t('readable')}</th>
                    <th className="px-2 py-1 font-medium">{t('not_readable')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detected.map(([col, spec]) => (
                    <tr key={col} className="border-t align-top">
                      <td className="px-2 py-1">
                        <Checkbox
                          aria-label={col}
                          checked={picked.includes(col)}
                          onCheckedChange={(c) => pick(c === true ? [...picked, col] : picked.filter((x) => x !== col))}
                        />
                      </td>
                      <td className="px-2 py-1">{col}</td>
                      <td className="px-2 py-1">
                        <p>{t(`type_${spec.type}`)}</p>
                        {spec.formats?.length ? (
                          <p className="text-xs text-muted-foreground">{spec.formats.join(' · ')}</p>
                        ) : null}
                        {spec.ambiguous && <Tag tone="warn">{t('date_ambiguous_short')}</Tag>}
                      </td>
                      <td className="px-2 py-1">{Math.round((spec.coverage ?? 1) * 100)}%</td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">
                        {(spec.failing ?? []).join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetectOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={picked.length === 0}
              onClick={() => {
                const columns = Object.fromEntries(
                  detected
                    .filter(([c]) => picked.includes(c))
                    .map(([c, spec]) => [
                      c,
                      Object.fromEntries(
                        Object.entries(spec).filter(
                          ([k, val]) => !['coverage', 'ambiguous', 'failing'].includes(k) && val != null
                        )
                      ),
                    ])
                );
                add({ set_types: { columns } });
                setDetectOpen(false);
              }}
            >
              {t('apply_types', { count: picked.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={Boolean(failures)} onOpenChange={(o) => !o && setFailures(null)}>
        <SheetContent className="w-[420px] sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle>{failures ? t('failures_title', { column: failures.column }) : ''}</SheetTitle>
            <SheetDescription>
              {failureStep ? t('failures_hint', { step: stepSentence(failureStep, t) }) : ''}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 overflow-y-auto px-4">
            {failureList.isLoading && <Loader2 className="size-4 animate-spin" aria-label={t('loading_preview')} />}
            <ul className="flex flex-col divide-y">
              {(failureList.data?.values ?? []).map((v) => (
                <li key={v.value} className="flex items-center justify-between gap-2 py-1.5">
                  <code className="rounded bg-muted px-1 text-xs">{v.value}</code>
                  <Tag>{v.count}</Tag>
                </li>
              ))}
            </ul>
            {!readOnly && failures && failureStep && formForStep(failureStep) && (
              <Button
                className="self-start"
                onClick={() => {
                  const i = failures.step;
                  setFailures(null);
                  editStep(i);
                }}
              >
                {t('edit_step')}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {onColumnMetaChange && meaningFor && (
        <ColumnMeaningDialog
          key={meaningFor.column}
          column={meaningFor.column}
          kind={meaningFor.kind}
          value={columnMeta?.[meaningFor.column]}
          onClose={() => setMeaningFor(null)}
          onSave={(meaning) => onColumnMetaChange({ ...(columnMeta ?? {}), [meaningFor.column]: meaning })}
        />
      )}
    </div>
  );
}
