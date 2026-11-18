// Ported from ../aicser/client/src/app/(dashboard)/prepare/page.tsx @ 749d38d (see PORTING.md). UI rewritten
// (DataTable, React Hook Form + Zod dialog).
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@/lib/desktop/router';
import { ChevronRight, Database, Loader2, Plus, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { createRecipe, listCleanCopies, listRecipes, listSourceTables, type Recipe } from '@/api/prep';
import { DataTable } from '@/components/aicser-ui/data-table';
import type { DataTableColumn } from '@/components/aicser-ui/data-table';
import { PageTitle, QueryState } from '@/components/aicser-ui/page';
import { Button } from '@/components/aicser-ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/aicser-ui/field';
import { Input } from '@/components/aicser-ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { useDataSources } from '@/lib/desktop/dataSources';
import { useWorkspace } from '@/lib/desktop/workspace';
import { tPrep as t } from '@/lib/prep/i18n';
import { z } from 'zod';
import { Tag } from './controls';
import { RecipeActions } from './RecipeActions';

export function RecipeStatus({ recipe }: { recipe: Pick<Recipe, 'status' | 'version'> }) {
  return recipe.status === 'published' ? (
    <Tag tone="good">{t('status_published', { version: recipe.version })}</Tag>
  ) : (
    <Tag>{recipe.version ? t('status_draft_changes', { version: recipe.version }) : t('status_draft')}</Tag>
  );
}

const newRecipeSchema = z.object({
  data_source_id: z.string().min(1, t('field_source_placeholder')),
  table: z.string(),
  name: z.string().trim().min(1, t('field_name_placeholder')).max(200),
});
type NewRecipe = z.infer<typeof newRecipeSchema>;

function NewRecipeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { project } = useWorkspace();
  const projectId = project?.id ?? null;
  const navigate = useNavigate();
  const sources = useDataSources(projectId);
  const list = useMemo(() => (sources.data ?? []).filter((s) => s.type !== 'warehouse'), [sources.data]);
  const form = useForm<NewRecipe>({
    resolver: zodResolver(newRecipeSchema),
    defaultValues: { data_source_id: '', table: '', name: '' },
  });
  const sourceId = useWatch({ control: form.control, name: 'data_source_id' });
  const source = list.find((s) => s.id === sourceId);
  // A database needs a table picked; so does a workbook with several sheets. A one-sheet file is its own table.
  const isFile = (source?.type ?? '').toLowerCase() === 'file';
  const tables = useQuery({
    queryKey: ['prep', 'tables', sourceId],
    queryFn: () => listSourceTables(sourceId),
    enabled: Boolean(source),
  });
  const needsTable = Boolean(source && (!isFile || (tables.data?.length ?? 0) > 1));

  const create = useMutation({
    mutationFn: (values: NewRecipe) =>
      createRecipe({
        name: values.name.trim(),
        data_source_id: values.data_source_id,
        table: needsTable ? values.table : null,
        project_id: projectId,
      }),
    onSuccess: (recipe) => {
      onOpenChange(false);
      void navigate({ to: '/prepare/$recipeId', params: { recipeId: recipe.id } });
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = form.handleSubmit((values) => {
    if (needsTable && !values.table) {
      form.setError('table', { message: t('field_table') });
      return;
    }
    create.mutate(values);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) form.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('new_recipe')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form id="new-recipe" className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <Controller
            control={form.control}
            name="data_source_id"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="recipe-source">{t('field_source')}</FieldLabel>
                <NativeSelect
                  id="recipe-source"
                  className="w-full"
                  aria-invalid={fieldState.invalid}
                  value={field.value}
                  onChange={(e) => {
                    field.onChange(e.target.value);
                    form.setValue('table', '');
                  }}
                >
                  <NativeSelectOption value="">
                    {sources.isLoading
                      ? t('loading_preview')
                      : list.length
                        ? t('field_source_placeholder')
                        : t('no_sources')}
                  </NativeSelectOption>
                  {list.map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {s.name || s.id}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
          {needsTable && (
            <Controller
              control={form.control}
              name="table"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="recipe-table">{t('field_table')}</FieldLabel>
                  <NativeSelect
                    id="recipe-table"
                    className="w-full"
                    aria-invalid={fieldState.invalid}
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                  >
                    <NativeSelectOption value="">{tables.isLoading ? t('loading_preview') : '—'}</NativeSelectOption>
                    {(tables.data ?? []).map((name) => (
                      <NativeSelectOption key={name} value={name}>
                        {name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {tables.error && <p className="text-sm text-destructive">{tables.error.message}</p>}
                  {fieldState.error && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          )}
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="recipe-name">{t('field_name')}</FieldLabel>
                <Input
                  id="recipe-name"
                  maxLength={200}
                  placeholder={t('field_name_placeholder')}
                  aria-invalid={fieldState.invalid}
                  {...field}
                />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="submit" form="new-recipe" disabled={create.isPending || (isFile && tables.isLoading)}>
            {create.isPending && <Loader2 className="animate-spin" />}
            {t('create_and_open')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Prepare: recipes of the selected project, each cleaning one table step by step. */
export function PreparePage() {
  const { project } = useWorkspace();
  const projectId = project?.id ?? null;
  const [open, setOpen] = useState(false);
  const recipes = useQuery({
    queryKey: ['prep', 'recipes', projectId],
    queryFn: () => listRecipes(projectId),
    enabled: projectId !== null,
  });
  const sources = useDataSources(projectId);
  const sourceName = useMemo(() => {
    const names = new Map((sources.data ?? []).map((s) => [s.id, s.name || s.id]));
    return (id: string) => names.get(id) ?? t('unknown_source');
  }, [sources.data]);
  const copies = useQuery({
    queryKey: ['prep', 'clean-copies', projectId],
    queryFn: () => listCleanCopies(projectId),
    enabled: projectId !== null,
  });
  // One row per source: how many recipes clean it and where its clean copy is. Clean copies are outputs, listed
  // on their source's row rather than as sources to clean.
  const sourceRows = useMemo(() => {
    const copyIds = new Set((copies.data ?? []).map((c) => c.id));
    const copyOf = new Map((copies.data ?? []).map((c) => [c.source_id ?? '', c]));
    return (sources.data ?? [])
      .filter((s) => s.type !== 'warehouse' && !copyIds.has(s.id))
      .map((s) => {
        const mine = (recipes.data ?? []).filter((r) => r.data_source_id === s.id);
        return {
          id: s.id,
          name: s.name || s.id,
          recipes: mine.length,
          published: mine.filter((r) => r.version > 0).length,
          copy: copyOf.get(s.id) ?? null,
        };
      })
      .sort((a, b) => b.recipes - a.recipes || a.name.localeCompare(b.name));
  }, [sources.data, copies.data, recipes.data]);
  type SourceRow = (typeof sourceRows)[number];
  const sourceColumns = useMemo<DataTableColumn<SourceRow>[]>(
    () => [
      {
        id: 'source',
        header: t('field_source'),
        cell: ({ row }) => (
          <Link
            to="/prepare/source/$sourceId"
            params={{ sourceId: row.original.id }}
            className="flex items-center gap-2 font-medium text-primary-active hover:underline"
          >
            <Database className="size-4" aria-hidden="true" />
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'recipes',
        header: t('col_recipes'),
        cell: ({ row }) =>
          row.original.recipes ? (
            t('recipes_count', { count: row.original.recipes, published: row.original.published })
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'copy',
        header: t('col_clean_copy'),
        cell: ({ row }) =>
          row.original.copy ? (
            <Link to="/data/sources/$sourceId" params={{ sourceId: row.original.copy.id }}>
              <Tag tone="good">{row.original.copy.name}</Tag>
            </Link>
          ) : (
            <Tag>{t('output_none')}</Tag>
          ),
      },
      {
        id: 'open',
        header: () => <span className="sr-only">{t('open_source')}</span>,
        cell: ({ row }) => (
          <Button asChild size="sm" variant="ghost">
            <Link to="/prepare/source/$sourceId" params={{ sourceId: row.original.id }}>
              {t('open_source')} <ChevronRight />
            </Link>
          </Button>
        ),
      },
    ],
    []
  );

  const columns = useMemo<DataTableColumn<Recipe>[]>(
    () => [
      {
        id: 'name',
        header: t('col_name'),
        cell: ({ row }) => (
          <Link
            to="/prepare/$recipeId"
            params={{ recipeId: row.original.id }}
            className="font-medium text-primary-active hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'source',
        header: t('col_source'),
        cell: ({ row }) => (
          <Link
            to="/prepare/source/$sourceId"
            params={{ sourceId: row.original.data_source_id }}
            className="hover:underline"
          >
            {sourceName(row.original.data_source_id)}
            {row.original.table && row.original.table !== 'data' && (
              <span className="text-muted-foreground"> · {row.original.table}</span>
            )}
          </Link>
        ),
      },
      { id: 'steps', header: t('col_steps'), cell: ({ row }) => row.original.steps.length },
      { id: 'status', header: t('col_status'), cell: ({ row }) => <RecipeStatus recipe={row.original} /> },
      {
        id: 'output',
        header: t('col_output'),
        cell: ({ row }) =>
          row.original.output.mode === 'table' && row.original.output.data_source_id ? (
            <Link to="/data/$sourceId" params={{ sourceId: row.original.output.data_source_id }}>
              <Tag tone="info">{t('output_table')}</Tag>
            </Link>
          ) : (
            <Tag>{t('output_none')}</Tag>
          ),
      },
      {
        id: 'updated',
        header: t('col_updated'),
        cell: ({ row }) =>
          row.original.updated_at
            ? new Date(row.original.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
            : '—',
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('more_actions')}</span>,
        cell: ({ row }) => (row.original.is_owner ? <RecipeActions recipe={row.original} /> : null),
      },
    ],
    [sourceName]
  );

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        icon={<Wrench className="size-5" aria-hidden="true" />}
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={() => setOpen(true)} disabled={!projectId}>
            <Plus /> {t('new_recipe')}
          </Button>
        }
      />
      {!projectId ? (
        <p className="text-sm text-muted-foreground">Choose a project in the header to see its recipes.</p>
      ) : (
        <QueryState query={recipes} feature="Prepare">
          {sourceRows.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">{t('sources_title')}</h2>
              <p className="text-sm text-muted-foreground">{t('sources_hint')}</p>
              <div className="rounded-xl border bg-card">
                <DataTable columns={sourceColumns} data={sourceRows} />
              </div>
            </section>
          )}
          <h2 className="text-sm font-semibold">{t('recipes_title')}</h2>
          {recipes.data?.length ? (
            <div className="rounded-xl border bg-card">
              <DataTable columns={columns} data={recipes.data} />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
              <Wrench className="size-8 text-primary" aria-hidden="true" />
              <p className="max-w-md text-sm text-muted-foreground">{t('empty')}</p>
              <Button onClick={() => setOpen(true)}>
                <Plus /> {t('new_recipe')}
              </Button>
            </div>
          )}
        </QueryState>
      )}
      <NewRecipeDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
