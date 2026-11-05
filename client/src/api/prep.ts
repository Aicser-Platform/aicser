import { fetchApi } from '@/utils/api';

/** One recipe step in the engine's own format: a single key naming the step, e.g. {"trim": {...}}. */
export type PrepStep = Record<string, Record<string, unknown>>;

export type StepCatalogEntry = {
  kind: string;
  group: string;
  label: string;
  schema: { properties?: Record<string, unknown>; required?: string[] };
};

export type PreviewColumn = { name: string; type: string };

export type SampleMode = 'first' | 'random' | 'full';

/** What one step did to the sample. */
export type StepStat = {
  step: number;
  rows?: number;
  rows_delta?: number;
  added?: string[];
  removed?: string[];
  retyped?: string[];
  /** Values the step turned empty, per column (e.g. dates it could not read). */
  emptied?: Record<string, number>;
  error?: string;
};

export type StepChanges = { added: string[]; removed: string[]; changed: Record<string, number[]> };

export type PreviewResult = {
  columns: PreviewColumn[];
  rows: Record<string, unknown>[];
  sql: string | null;
  step_errors: { step: number; message: string }[];
  quarantined_count: number;
  table: string;
  sample_rows: number;
  sample_mode: SampleMode;
  sampled: boolean;
  step_stats?: StepStat[];
  changes?: StepChanges;
};

export type ColumnDistribution = {
  rows: number;
  empty: number;
  distinct: number;
  kind: 'number' | 'date' | 'text';
  histogram?: { start: number; end: number; count: number }[];
  top?: { value: string; count: number }[];
  min?: number;
  max?: number;
};

export type TypeSpec = {
  type: 'text' | 'integer' | 'number' | 'decimal' | 'boolean' | 'date' | 'datetime';
  formats?: string[];
  locale?: 'us' | 'eu';
  excel_serial?: boolean;
  coverage?: number;
  ambiguous?: boolean;
  failing?: string[];
};

export type Finding = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  column?: string | null;
  message_key: string;
  params: Record<string, unknown>;
  suggested_step?: PrepStep | null;
};

export type ColumnProfile = {
  name: string;
  storage_type: string;
  inferred_type: string;
  null_count: number;
  null_ratio: number;
  distinct_count: number;
  blank_count: number;
  null_token_count: number;
};

export type ProfileResult = {
  table: string;
  /** Empty while a step can't run; the preview names the step. */
  health: number | null;
  findings: Finding[];
  profile: { row_count: number; sampled: boolean; columns: ColumnProfile[] } | null;
  distributions?: Record<string, ColumnDistribution>;
  error?: string;
};

export type SampleOptions = { sample_mode?: SampleMode; sample_rows?: number };

export type ColumnRole = 'amount' | 'count' | 'category' | 'date' | 'id' | 'text';
/** What an output column means, set in Prepare and written onto the table the recipe makes. */
export type ColumnMeaning = { description?: string | null; role?: ColumnRole | null; personal?: boolean };

/** A decision on an issue no step fixes (Evaluate in the CLEAN panel). */
export type CleaningDecision = { action: 'keep' | 'exclude' | 'note'; reason?: string | null };
/** The CLEAN panel's saved state: decisions per issue, and notes on the dataset. */
export type CleaningLog = { decisions?: Record<string, CleaningDecision>; note?: string | null };

export type Recipe = {
  id: string;
  name: string;
  description?: string | null;
  data_source_id: string;
  table?: string | null;
  steps: PrepStep[];
  status: 'draft' | 'published';
  version: number;
  output: { mode?: 'view' | 'table'; data_source_id?: string; name?: string; rows?: number; ran_at?: string };
  column_meta?: Record<string, ColumnMeaning>;
  cleaning?: CleaningLog;
  project_id?: string | null;
  is_owner: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export type RecipeVersion = {
  version: number;
  note?: string | null;
  steps: PrepStep[];
  table?: string | null;
  author_id: string;
  created_at?: string | null;
};

const withProject = (path: string, projectId?: string | null) =>
  projectId ? `${path}${path.includes('?') ? '&' : '?'}project_id=${encodeURIComponent(projectId)}` : path;

const post = <T>(path: string, body: unknown) =>
  fetchApi<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const listSteps = () =>
  fetchApi<{ steps: StepCatalogEntry[] }>('/api/prep/steps').then((r) => r.steps ?? []);

type SourceBody = { data_source_id: string; table?: string | null; lake_object_id?: string | null; steps: PrepStep[] } & SampleOptions;

export const previewSteps = (
  body: SourceBody & { up_to_step?: number | null; limit?: number },
  projectId?: string | null,
) => post<PreviewResult>(withProject('/api/prep/preview', projectId), body);

export const profileSteps = (body: SourceBody, projectId?: string | null) =>
  post<ProfileResult>(withProject('/api/prep/profile', projectId), body);

export const detectTypes = (body: SourceBody, projectId?: string | null) =>
  post<{ table: string; columns: Record<string, TypeSpec> }>(withProject('/api/prep/detect', projectId), body);

export const failedValues = (body: SourceBody & { step: number; column: string }, projectId?: string | null) =>
  post<{ values: { value: string; count: number }[] }>(withProject('/api/prep/failures', projectId), body);

export const checkFormula = (expression: string, language: 'excel' | 'sql', columns: string[]) =>
  post<{ ok: boolean; sql?: string; error?: string; columns_used?: string[]; functions: string[] }>('/api/prep/formula', {
    expression,
    language,
    columns,
  });

export const datePatterns = (example: string) =>
  post<{ formats: string[] }>('/api/prep/date-pattern', { example }).then((r) => r.formats ?? []);

export const listRecipes = (projectId?: string | null, dataSourceId?: string) =>
  fetchApi<{ recipes: Recipe[] }>(
    withProject(`/api/prep/recipes${dataSourceId ? `?data_source_id=${encodeURIComponent(dataSourceId)}` : ''}`, projectId),
  ).then((r) => r.recipes ?? []);

export const createRecipe = (body: {
  name: string;
  data_source_id: string;
  table?: string | null;
  steps?: PrepStep[];
  project_id?: string | null;
}) => post<Recipe>('/api/prep/recipes', body);

export const getRecipe = (id: string) => fetchApi<Recipe>(`/api/prep/recipes/${encodeURIComponent(id)}`);

export const updateRecipe = (
  id: string,
  body: Partial<{ name: string; description: string; table: string; steps: PrepStep[]; column_meta: Record<string, ColumnMeaning>; cleaning: CleaningLog }>,
) => fetchApi<Recipe>(`/api/prep/recipes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteRecipe = (id: string) =>
  fetchApi<void>(`/api/prep/recipes/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const publishRecipe = (id: string, note?: string) =>
  post<Recipe>(`/api/prep/recipes/${encodeURIComponent(id)}/publish`, { note: note || null });

export const listRecipeVersions = (id: string) =>
  fetchApi<{ versions: RecipeVersion[] }>(`/api/prep/recipes/${encodeURIComponent(id)}/versions`).then(
    (r) => r.versions ?? [],
  );

export const restoreRecipeVersion = (id: string, version: number) =>
  post<Recipe>(`/api/prep/recipes/${encodeURIComponent(id)}/versions/${version}/restore`, {});

export type RecipeImpact = {
  removed: string[];
  retyped: { column: string; from: string; to: string }[];
  pipelines: string[];
  saved_table: string | null;
  metrics: string[];
  /** Certified-table contracts this change would break; "block" ones refuse the publish. */
  contracts?: { id: string; table: string | null; layer: string; on_breach: 'warn' | 'block'; breaches: { code: string; column?: string }[] }[];
  error?: boolean;
};

export const getRecipeImpact = (id: string) => fetchApi<RecipeImpact>(`/api/prep/recipes/${encodeURIComponent(id)}/impact`);

export const saveRecipeAsTable = (id: string, name?: string) =>
  post<{ data_source_id: string; name: string; rows: number; columns: number; truncated: boolean }>(
    `/api/prep/recipes/${encodeURIComponent(id)}/save-as-table`,
    { name: name || null },
  );

/** The step's kind and its settings, from the single-key form. */
export const stepParts = (step: PrepStep): [string, Record<string, unknown>] => {
  const kind = Object.keys(step)[0] ?? '';
  return [kind, (step[kind] as Record<string, unknown>) ?? {}];
};
