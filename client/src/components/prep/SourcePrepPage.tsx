'use client';

// One source, every table: which ones need cleaning, their recipes, and what the source's clean copy holds.
// Built for sources with many tables: search, filters, health per table, and one "Save all" that fills a single
// clean connection (cleaned tables through their published recipe, the rest as they are) that Ask can join.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Database, ExternalLink, Loader2, MessageSquare, Search, Sparkles, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  createRecipe,
  getSourceOverview,
  profileSteps,
  saveSourceToCleanCopy,
  type SaveAllResult,
  type SourceTable,
} from '@/api/prep';
import { Button } from '@/components/aicser-ui/button';
import { Checkbox } from '@/components/aicser-ui/checkbox';
import { DataTable, type DataTableColumn } from '@/components/aicser-ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import { Input } from '@/components/aicser-ui/input';
import { QueryState } from '@/components/aicser-ui/page';
import { Link, useNavigate } from '@/lib/desktop/router';
import { useWorkspace } from '@/lib/desktop/workspace';
import { tPrep as t } from '@/lib/prep/i18n';
import { Tag, type Tone } from './controls';
import { RecipeStatus } from './PreparePage';

const PAGE = 25;
type Filter = 'all' | 'todo' | 'draft' | 'unsaved' | 'outdated';

const healthTone = (score: number): Tone => (score >= 85 ? 'good' : score >= 65 ? 'warn' : 'bad');

/** Health of the raw table (before any recipe) and how many issues Prepare would flag; checked per visible row. */
function HealthCell({ sourceId, table, projectId }: { sourceId: string; table: string; projectId: string | null }) {
  const health = useQuery({
    queryKey: ['prep', 'table-health', sourceId, table, projectId],
    queryFn: () =>
      profileSteps({ data_source_id: sourceId, table, steps: [], sample_mode: 'first', sample_rows: 500 }, projectId),
    staleTime: 10 * 60_000,
    retry: false,
  });
  if (health.isLoading)
    return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t('source_checking')} />;
  if (health.error || health.data?.health == null) return <span className="text-xs text-muted-foreground">—</span>;
  const issues = health.data.findings.length;
  return (
    <span className="flex items-center gap-1.5">
      <Tag tone={healthTone(health.data.health)} title={t('source_health_hint')}>
        {health.data.health}
      </Tag>
      <span className="text-xs text-muted-foreground">{t('source_issues', { count: issues })}</span>
    </span>
  );
}

function SavedCell({ row }: { row: SourceTable }) {
  if (!row.saved) return <Tag>{t('source_not_saved')}</Tag>;
  if (row.outdated) return <Tag tone="warn">{t('source_outdated', { version: row.recipe?.version ?? 0 })}</Tag>;
  return (
    <span className="flex items-center gap-1.5">
      {row.saved.as_is ? (
        <Tag tone="info">{t('source_copied')}</Tag>
      ) : (
        <Tag tone="good">{t('source_cleaned', { version: row.saved.recipe_version ?? 0 })}</Tag>
      )}
      {row.saved.rows != null && (
        <span className="text-xs text-muted-foreground">{t('source_rows', { count: row.saved.rows })}</span>
      )}
    </span>
  );
}

export function SourcePrepPage({ sourceId }: { sourceId: string }) {
  const { project } = useWorkspace();
  const projectId = project?.id ?? null;
  const client = useQueryClient();
  const navigate = useNavigate();
  const overview = useQuery({
    queryKey: ['prep', 'source', sourceId, projectId],
    queryFn: () => getSourceOverview(sourceId, projectId),
    enabled: projectId !== null,
  });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveOpen, setSaveOpen] = useState(false);
  const [includeRaw, setIncludeRaw] = useState(true);
  const [result, setResult] = useState<SaveAllResult | null>(null);

  const tables = useMemo(() => overview.data?.tables ?? [], [overview.data]);
  const counts = useMemo(
    () => ({
      all: tables.length,
      todo: tables.filter((r) => !r.recipe).length,
      draft: tables.filter((r) => r.recipe && !r.recipe.version).length,
      unsaved: tables.filter((r) => !r.saved).length,
      outdated: tables.filter((r) => r.outdated).length,
    }),
    [tables]
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (filter === 'todo') return !r.recipe;
      if (filter === 'draft') return Boolean(r.recipe && !r.recipe.version);
      if (filter === 'unsaved') return !r.saved;
      if (filter === 'outdated') return r.outdated;
      return true;
    });
  }, [tables, search, filter]);
  const page = visible.slice(0, shown);

  const start = useMutation({
    mutationFn: (table: string) =>
      createRecipe({ name: `${table} (clean)`, data_source_id: sourceId, table, project_id: projectId }),
    onSuccess: (recipe) => void navigate({ to: '/prepare/$recipeId', params: { recipeId: recipe.id } }),
    onError: (error) => toast.error(error.message),
  });

  const saveAll = useMutation({
    mutationFn: () =>
      saveSourceToCleanCopy(
        sourceId,
        { include_unprepared: includeRaw, tables: selected.size ? [...selected] : null },
        projectId
      ),
    onSuccess: (res) => {
      setResult(res);
      setSelected(new Set());
      void client.invalidateQueries({ queryKey: ['prep', 'source', sourceId] });
      void client.invalidateQueries({ queryKey: ['data-sources'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const toggle = (name: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  // Rebuilt each render: the cells read the selection and the pending "Clean".
  const columns: DataTableColumn<SourceTable>[] = [
    {
      id: 'select',
      header: () => (
        <Checkbox
          aria-label={t('source_select_all')}
          checked={page.length > 0 && page.every((r) => selected.has(r.name))}
          onCheckedChange={(on) => page.forEach((r) => toggle(r.name, on === true))}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={row.original.name}
          checked={selected.has(row.original.name)}
          onCheckedChange={(on) => toggle(row.original.name, on === true)}
        />
      ),
    },
    {
      id: 'table',
      header: t('field_table'),
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          {row.original.rows != null && (
            <span className="text-xs text-muted-foreground">{t('source_rows', { count: row.original.rows })}</span>
          )}
        </span>
      ),
    },
    {
      id: 'health',
      header: t('source_col_health'),
      cell: ({ row }) => <HealthCell sourceId={sourceId} table={row.original.name} projectId={projectId} />,
    },
    {
      id: 'recipe',
      header: t('col_name'),
      cell: ({ row }) => {
        const recipe = row.original.recipe;
        if (!recipe) {
          return (
            <Button
              size="sm"
              variant="outline"
              disabled={start.isPending}
              onClick={() => start.mutate(row.original.name)}
            >
              {start.isPending && start.variables === row.original.name ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              {t('source_clean')}
            </Button>
          );
        }
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <Link
              to="/prepare/$recipeId"
              params={{ recipeId: recipe.id }}
              className="font-medium text-primary-active hover:underline"
            >
              {recipe.name}
            </Link>
            <RecipeStatus recipe={recipe} />
            {row.original.other_recipes > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('source_more_recipes', { count: row.original.other_recipes })}
              </span>
            )}
          </span>
        );
      },
    },
    { id: 'saved', header: t('source_col_saved'), cell: ({ row }) => <SavedCell row={row.original} /> },
  ];

  const data = overview.data;
  const copy = data?.clean_copy ?? null;
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('source_filter_all', { count: counts.all }) },
    { id: 'todo', label: t('source_filter_todo', { count: counts.todo }) },
    { id: 'draft', label: t('source_filter_draft', { count: counts.draft }) },
    { id: 'unsaved', label: t('source_filter_unsaved', { count: counts.unsaved }) },
    { id: 'outdated', label: t('source_filter_outdated', { count: counts.outdated }) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start gap-3">
        <Button asChild size="icon-sm" variant="ghost" aria-label={t('back')} title={t('back')}>
          <Link to="/prepare">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Database className="size-5 text-primary" aria-hidden="true" />
            <span className="truncate">{t('source_title', { name: data?.source.name ?? '…' })}</span>
          </h1>
          <p className="text-sm text-muted-foreground">{t('source_description')}</p>
        </div>
        <Button onClick={() => setSaveOpen(true)} disabled={!tables.length}>
          <Wrench />
          {selected.size ? t('source_save_selected', { count: selected.size }) : t('source_save_all')}
        </Button>
      </header>

      {projectId === null ? (
        <p className="text-sm text-muted-foreground">{t('source_pick_project')}</p>
      ) : (
        <QueryState query={overview} feature="Prepare">
          <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t('source_copy_title')}</p>
              <p className="text-sm text-muted-foreground">
                {copy
                  ? t('source_copy_ready', {
                      name: copy.name,
                      count: tables.filter((r) => r.saved).length,
                      date: copy.updated_at
                        ? new Date(copy.updated_at).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : '',
                    })
                  : t('source_copy_none')}
              </p>
            </div>
            {copy && (
              <>
                <Button asChild size="sm" variant="outline">
                  <Link to="/data/sources/$sourceId" params={{ sourceId: copy.id }}>
                    <ExternalLink /> {t('open_connection')}
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <a href={`/chat?data_source_id=${encodeURIComponent(copy.id)}`}>
                    <MessageSquare /> {t('source_ask')}
                  </a>
                </Button>
              </>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search
                className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                className="pl-8"
                value={search}
                placeholder={t('source_search')}
                aria-label={t('source_search')}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShown(PAGE);
                }}
              />
            </div>
            <div role="group" aria-label={t('source_filter')} className="flex flex-wrap gap-1">
              {filters.map((f) => (
                <Button
                  key={f.id}
                  size="sm"
                  variant={filter === f.id ? 'secondary' : 'ghost'}
                  aria-pressed={filter === f.id}
                  onClick={() => {
                    setFilter(f.id);
                    setShown(PAGE);
                  }}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-card">
            <DataTable columns={columns} data={page} emptyMessage={t('source_no_tables')} />
          </div>
          {visible.length > shown && (
            <Button variant="outline" className="self-center" onClick={() => setShown((n) => n + PAGE)}>
              {t('source_show_more', { count: visible.length - shown })}
            </Button>
          )}
        </QueryState>
      )}

      <Dialog
        open={saveOpen}
        onOpenChange={(o) => {
          setSaveOpen(o);
          if (!o) setResult(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected.size ? t('source_save_selected', { count: selected.size }) : t('source_save_all')}
            </DialogTitle>
            <DialogDescription>{t('source_save_hint', { name: copy?.name ?? t('source_copy_new') })}</DialogDescription>
          </DialogHeader>
          {!result ? (
            <label htmlFor="include-raw" className="flex items-start gap-2 text-sm">
              <Checkbox
                id="include-raw"
                checked={includeRaw}
                onCheckedChange={(on) => setIncludeRaw(on === true)}
                className="mt-0.5"
              />
              <span>
                {t('source_include_raw')}
                <span className="block text-xs text-muted-foreground">{t('source_include_raw_hint')}</span>
              </span>
            </label>
          ) : (
            <ul className="flex max-h-72 flex-col divide-y overflow-y-auto text-sm" aria-label={t('source_results')}>
              {result.tables.map((r) => (
                <li key={r.table} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate font-medium">{r.table}</span>
                  <span className="flex items-center gap-1.5">
                    {r.status === 'cleaned' && <Tag tone="good">{t('source_result_cleaned')}</Tag>}
                    {r.status === 'copied' && <Tag tone="info">{t('source_result_copied')}</Tag>}
                    {r.status === 'skipped' && (
                      <Tag>{r.reason === 'draft' ? t('source_result_draft') : t('source_result_no_recipe')}</Tag>
                    )}
                    {r.status === 'error' && (
                      <Tag tone="bad" title={r.message}>
                        {t('source_result_error')}
                      </Tag>
                    )}
                    {r.rows != null && (
                      <span className="text-xs text-muted-foreground">{t('source_rows', { count: r.rows })}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            {!result ? (
              <>
                <Button variant="outline" onClick={() => setSaveOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button disabled={saveAll.isPending} onClick={() => saveAll.mutate()}>
                  {saveAll.isPending && <Loader2 className="animate-spin" />}
                  {saveAll.isPending ? t('source_saving') : t('source_save')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setSaveOpen(false)}>
                  {t('close')}
                </Button>
                {result.clean_copy && (
                  <Button asChild>
                    <a href={`/chat?data_source_id=${encodeURIComponent(result.clean_copy.id)}`}>
                      <MessageSquare /> {t('source_ask')}
                    </a>
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
