// Ported from ../aicser/client/src/app/(dashboard)/prepare/[id]/page.tsx @ 749d38d (see PORTING.md). UI rewritten.
// Not on desktop: "Use the result" for prediction models / AI decisions (Enterprise pages desktop doesn't have).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@/lib/desktop/router';
import { ArrowLeft, ExternalLink, History, Info, Loader2, Pencil, Save, Table2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  getRecipe,
  getRecipeImpact,
  listRecipeVersions,
  publishRecipe,
  restoreRecipeVersion,
  saveRecipeAsTable,
  updateRecipe,
  type PrepStep,
  type Recipe,
} from '@/api/prep';
import { Button } from '@/components/aicser-ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import { Input } from '@/components/aicser-ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/aicser-ui/sheet';
import { Textarea } from '@/components/aicser-ui/textarea';
import { tPrep as t } from '@/lib/prep/i18n';
import { describeStep } from '@/lib/prep/recipeSteps';
import { Tag } from './controls';
import { RecipeStatus } from './PreparePage';
import { RecipeActions } from './RecipeActions';
import { RecipeEditor } from './RecipeEditor';

const AUTOSAVE_MS = 700;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function Title({ recipe, onRename }: { recipe: Recipe; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(recipe.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  if (editing && recipe.is_owner) {
    return (
      <Input
        ref={inputRef}
        className="h-8 w-64"
        aria-label={t('field_name')}
        value={name}
        maxLength={200}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onRename(name);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setName(recipe.name);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <h2 className="flex min-w-0 items-center gap-1 text-lg font-semibold">
      <span className="truncate">{recipe.name}</span>
      {recipe.is_owner && (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('rename')}
          title={t('rename')}
          onClick={() => {
            setName(recipe.name);
            setEditing(true);
          }}
        >
          <Pencil />
        </Button>
      )}
    </h2>
  );
}

/** One recipe: name, state and actions on one bar, the editor below. Steps autosave as you edit. */
export function RecipePage({ recipeId }: { recipeId: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const recipe = useQuery({ queryKey: ['prep', 'recipe', recipeId], queryFn: () => getRecipe(recipeId) });
  // Local edits win; until the first edit, show the saved steps.
  const [edited, setEdited] = useState<PrepStep[] | null>(null);
  const steps = edited ?? recipe.data?.steps ?? null;
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [note, setNote] = useState('');
  const [tableOpen, setTableOpen] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  const [saved, setSaved] = useState<{ name: string; table: string; text: string; sourceId: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setRecipe = (r: Recipe) => {
    client.setQueryData(['prep', 'recipe', recipeId], r);
    void client.invalidateQueries({ queryKey: ['prep', 'recipes'] });
  };

  const changeSteps = (next: PrepStep[]) => {
    setEdited(next);
    setSaving('saving');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      updateRecipe(recipeId, { steps: next })
        .then((r) => {
          setRecipe(r);
          setSaving('saved');
        })
        .catch((error: unknown) => {
          setSaving('error');
          toast.error(message(error));
        });
    }, AUTOSAVE_MS);
  };

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const rename = async (name: string) => {
    if (!name.trim() || name === recipe.data?.name) return;
    try {
      setRecipe(await updateRecipe(recipeId, { name: name.trim() }));
    } catch (error) {
      toast.error(message(error));
    }
  };

  const impact = useQuery({
    queryKey: ['prep', 'impact', recipeId, JSON.stringify(steps)],
    queryFn: () => getRecipeImpact(recipeId),
    enabled: publishOpen,
  });
  const breaking = Boolean(impact.data && (impact.data.removed.length || impact.data.retyped.length));
  const contracts = impact.data?.contracts ?? [];
  const blocked = contracts.some((c) => c.on_breach === 'block');
  const dependents = impact.data
    ? [
        ...impact.data.pipelines.map((p) => t('impact_pipeline', { name: p })),
        ...(impact.data.saved_table ? [t('impact_table', { name: impact.data.saved_table })] : []),
        ...impact.data.metrics.map((m) => t('impact_metric', { name: m })),
      ]
    : [];

  const versions = useQuery({
    queryKey: ['prep', 'versions', recipeId],
    queryFn: () => listRecipeVersions(recipeId),
    enabled: historyOpen,
  });

  const publish = useMutation({
    mutationFn: () => publishRecipe(recipeId, note),
    onSuccess: (r) => {
      setRecipe(r);
      setPublishOpen(false);
      setNote('');
      toast.success(t('published_toast', { version: r.version }));
      // Publishing saves the steps; the clean rows reach Ask, dashboards and SQL through the source's clean copy.
      setJustPublished(true);
      setTableOpen(true);
    },
    onError: (error) => toast.error(error.message),
  });

  const restore = useMutation({
    mutationFn: (version: number) => restoreRecipeVersion(recipeId, version),
    onSuccess: (r) => {
      setRecipe(r);
      setEdited(r.steps);
      setHistoryOpen(false);
      toast.success(t('restored_toast'));
    },
    onError: (error) => toast.error(error.message),
  });

  const saveTable = useMutation({
    mutationFn: () => saveRecipeAsTable(recipeId),
    onSuccess: (res) => {
      setTableOpen(false);
      setJustPublished(false);
      void client.invalidateQueries({ queryKey: ['prep', 'recipe', recipeId] });
      void client.invalidateQueries({ queryKey: ['data-sources'] });
      void client.invalidateQueries({ queryKey: ['prep', 'source'] });
      void client.invalidateQueries({ queryKey: ['prep', 'clean-copies'] });
      setSaved({
        name: res.name,
        table: res.table,
        sourceId: res.data_source_id,
        text: res.truncated
          ? t('saved_table_truncated', { rows: res.rows })
          : t('saved_copy_body', { rows: res.rows, columns: res.columns, tables: res.tables }),
      });
    },
    onError: (error) => toast.error(error.message),
  });

  if (recipe.isLoading || !recipe.data || steps === null) {
    return recipe.error ? (
      <p role="alert" className="text-sm text-destructive">
        {recipe.error.message}
      </p>
    ) : (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {t('loading_preview')}
      </p>
    );
  }

  const r = recipe.data;
  const outputSource = r.output.data_source_id;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* One bar for name, state and actions: the rows below belong to the data. */}
      <header className="flex flex-wrap items-center gap-2">
        <Button asChild size="icon-sm" variant="ghost" aria-label={t('back_to_source')} title={t('back_to_source')}>
          <Link to="/prepare/source/$sourceId" params={{ sourceId: r.data_source_id }}>
            <ArrowLeft />
          </Link>
        </Button>
        <Title key={r.name} recipe={r} onRename={(name) => void rename(name)} />
        {r.table && r.table !== 'data' && <Tag title={t('field_table')}>{r.table}</Tag>}
        <RecipeStatus recipe={r} />
        <span title={t('editor_description')} className="text-muted-foreground">
          <Info className="size-4" aria-label={t('editor_description')} />
        </span>
        <span className="text-xs text-muted-foreground" role="status">
          {saving === 'saving'
            ? t('saving')
            : saving === 'saved'
              ? t('saved')
              : saving === 'error'
                ? t('save_failed')
                : ''}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {/* One primary action (Publish); the rest are icons named on hover. */}
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t('history')}
            title={t('history')}
            onClick={() => setHistoryOpen(true)}
          >
            <History />
          </Button>
          <Button size="sm" variant="outline" title={t('save_to_copy_hint')} onClick={() => setTableOpen(true)}>
            <Table2 /> {t('save_to_copy')}
          </Button>
          {outputSource && (
            <Button
              asChild
              size="icon-sm"
              variant="outline"
              aria-label={t('use_open_table')}
              title={t('use_open_table')}
            >
              <Link to="/data/sources/$sourceId" params={{ sourceId: outputSource }}>
                <ExternalLink />
              </Link>
            </Button>
          )}
          <Button size="sm" onClick={() => setPublishOpen(true)} disabled={r.status === 'published'}>
            <Save /> {t('publish')}
          </Button>
          {r.is_owner && (
            <RecipeActions recipe={r} withRename={false} afterDelete={() => void navigate({ to: '/prepare' })} />
          )}
        </span>
      </header>

      <RecipeEditor
        dataSourceId={r.data_source_id}
        table={r.table}
        projectId={r.project_id}
        steps={steps}
        onChange={changeSteps}
        readOnly={!r.is_owner}
        columnMeta={r.column_meta}
        onColumnMetaChange={
          r.is_owner ? async (meta) => setRecipe(await updateRecipe(recipeId, { column_meta: meta })) : undefined
        }
        name={r.name}
        cleaning={r.cleaning}
        onCleaningChange={
          r.is_owner ? async (log) => setRecipe(await updateRecipe(recipeId, { cleaning: log })) : undefined
        }
      />

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('publish_title', { version: r.version + 1 })}</DialogTitle>
            <DialogDescription>{t('publish_hint')}</DialogDescription>
          </DialogHeader>
          {impact.isLoading && <Loader2 className="size-4 animate-spin" aria-label={t('checking_data')} />}
          {contracts.length > 0 && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-sm">
              <p className="font-medium text-destructive">{blocked ? t('contract_blocked') : t('contract_warning')}</p>
              <p>
                {contracts
                  .map((c) =>
                    t('contract_line', {
                      table: c.table ?? t('this_table'),
                      columns: c.breaches
                        .map((b) => b.column)
                        .filter(Boolean)
                        .join(', '),
                    })
                  )
                  .join(' ')}
              </p>
            </div>
          )}
          {breaking && impact.data && (
            <div className="rounded-lg border p-2 text-sm">
              <p className="font-medium">
                {t('impact_title', { removed: impact.data.removed.length, retyped: impact.data.retyped.length })}
              </p>
              <p>
                {[...impact.data.removed, ...impact.data.retyped.map((x) => `${x.column} (${x.from} → ${x.to})`)].join(
                  ', '
                )}
              </p>
              {dependents.length > 0 && <p>{t('impact_used_by', { list: dependents.join(', ') })}</p>}
            </div>
          )}
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('publish_note')}
            aria-label={t('publish_note')}
            rows={3}
            maxLength={1000}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              {t('cancel')}
            </Button>
            <Button disabled={blocked || publish.isPending} onClick={() => publish.mutate()}>
              {publish.isPending && <Loader2 className="animate-spin" />}
              {t('publish')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tableOpen}
        onOpenChange={(o) => {
          setTableOpen(o);
          if (!o) setJustPublished(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('save_to_copy')}</DialogTitle>
            <DialogDescription>
              {justPublished ? `${t('use_clean_data_hint')} ` : ''}
              {t('save_to_copy_hint')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTableOpen(false)}>
              {t('cancel')}
            </Button>
            <Button disabled={saveTable.isPending} onClick={() => saveTable.mutate()}>
              {saveTable.isPending && <Loader2 className="animate-spin" />}
              {t('save_to_copy')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saved !== null} onOpenChange={(o) => !o && setSaved(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{saved ? t('saved_copy_title', { table: saved.table, name: saved.name }) : ''}</DialogTitle>
            <DialogDescription>{saved?.text}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-wrap">
            <Button variant="outline" onClick={() => setSaved(null)}>
              {t('close')}
            </Button>
            {saved && (
              <>
                <Button asChild variant="outline">
                  <Link to="/prepare/source/$sourceId" params={{ sourceId: r.data_source_id }}>
                    {t('next_table')}
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/data/sources/$sourceId" params={{ sourceId: saved.sourceId }}>
                    {t('open_connection')}
                  </Link>
                </Button>
                <Button asChild>
                  <a href={`/chat?data_source_id=${encodeURIComponent(saved.sourceId)}`}>{t('source_ask')}</a>
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="w-[460px] sm:max-w-[460px]">
          <SheetHeader>
            <SheetTitle>{t('history')}</SheetTitle>
            <SheetDescription className="sr-only">{t('history')}</SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-4">
            {versions.isLoading && <Loader2 className="size-4 animate-spin" aria-label={t('history')} />}
            {versions.data && !versions.data.length && (
              <p className="text-sm text-muted-foreground">{t('no_versions')}</p>
            )}
            <ul aria-label={t('history')} className="flex flex-col divide-y">
              {(versions.data ?? []).map((v) => (
                <li key={v.version} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t('version_label', { version: v.version })}</p>
                    {v.note && <p className="text-sm">{v.note}</p>}
                    <p className="text-xs text-muted-foreground">
                      {t('version_meta', {
                        steps: v.steps.length,
                        date: v.created_at ? new Date(v.created_at).toLocaleString() : '',
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {v.steps
                        .slice(0, 4)
                        .map((s) => describeStep(s, (k) => k))
                        .join(' → ')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(v.version)}
                  >
                    {restore.isPending && restore.variables === v.version && <Loader2 className="animate-spin" />}
                    {t('restore')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
