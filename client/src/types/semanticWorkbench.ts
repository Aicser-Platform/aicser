/** Types for the Semantic Workbench (governed queries, pivot, YAML IDE). */

export type SemanticFilterInput = {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'like';
  value: string | number | boolean | Array<string | number>;
};

export type SemanticQueryRequest = {
  data_source_id: string;
  view_name?: string | null;
  /** One or more governed metric names; single entry keeps the metric_value alias server-side. */
  metrics: string[];
  dimensions: string[];
  filters: SemanticFilterInput[];
  time_grain?: 'day' | 'week' | 'month' | 'quarter' | 'year' | null;
  order_by?: string | null;
  order_dir?: 'asc' | 'desc';
  limit?: number;
};

export type SemanticQueryResult = {
  success: boolean;
  rows: Array<Record<string, unknown>>;
  sql: string;
  error: string;
};

export type SemanticCatalogMetric = {
  id?: string;
  name: string;
  description?: string;
  format?: string | null;
  metric_type?: string;
  certified?: boolean;
  expression?: string;
  table_name?: string;
  drill_fields?: string[];
  ai_context?: string;
};

export type SemanticCatalogDimension = {
  id?: string;
  name: string;
  description?: string;
  expression?: string;
  values_sample?: string | string[] | null;
  table_name?: string;
};

export type SemanticViewInclude = string | {
  name: string;
  alias?: string;
  label?: string;
  description?: string;
  meta?: { ai_context?: string };
};

export type SemanticViewModel = {
  join_path: string;
  prefix?: boolean;
  includes: '*' | SemanticViewInclude[];
  excludes?: string[];
};

export type SemanticView = {
  name: string;
  label?: string;
  description: string;
  public?: boolean;
  meta?: { ai_context?: string };
  models?: SemanticViewModel[];
  cubes?: SemanticViewModel[];
  default_drill_fields?: string[];
};

export type SemanticContext = {
  metrics: SemanticCatalogMetric[];
  dimensions: SemanticCatalogDimension[];
  time_spines: Array<{ name: string; base_column: string; grain: string }>;
  join_paths: Array<Record<string, string>>;
  certified_metric_count?: number;
  views?: SemanticView[];
  agent_context?: Array<{ path: string; content: string }>;
};

export type YamlFileEntry = {
  path: string;
  content: string;
  is_dir?: boolean;
};

export type YamlIssue = {
  file: string;
  path: string;
  message: string;
};

export type YamlFilesResponse = {
  dir: string;
  files: YamlFileEntry[];
  issues: YamlIssue[];
  synced?: boolean;
  counts?: Record<string, number>;
};

export type YamlSaveResponse = {
  success: boolean;
  issues: YamlIssue[];
};

export type YamlSyncResult = {
  success: boolean;
  results: Array<{
    dir: string;
    synced: boolean;
    data_source_id?: string;
    counts?: Record<string, number>;
    issues?: YamlIssue[];
  }>;
};

export type LineageColumn = { name: string; type: string };

export type LineageTable = {
  name: string;
  source: string;
  description: string;
  columns: LineageColumn[];
};

export type LineageJoin = {
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  join_type: string;
};

export type LineageMetric = {
  name: string;
  table: string;
  type: string;
  format: string | null;
  certified: boolean;
  description: string;
};

export type SemanticLineage = {
  source: { id: string; name: string };
  tables: LineageTable[];
  joins: LineageJoin[];
  metrics: LineageMetric[];
  issues?: YamlIssue[];
};

export type MemberKind = 'metric' | 'measure';

export type MetricDefinition = {
  name: string;
  type: 'simple' | 'ratio';
  measure?: string;
  filters?: string[];
  numerator?: { measure: string; filters?: string[] };
  denominator?: { measure: string; filters?: string[] };
  format?: 'currency_usd' | 'number' | 'percent';
  label?: string;
  description: string;
};

export type MeasureDefinition = {
  name: string;
  column: string;
  agg: 'sum' | 'count' | 'count_distinct' | 'avg' | 'min' | 'max';
  description: string;
};

export type UpsertMemberRequest = {
  data_source_id: string;
  table: string;
  kind: MemberKind;
  definition: MetricDefinition | MeasureDefinition;
};

export type UpsertMemberResponse = {
  success: boolean;
  issues: YamlIssue[];
  file: YamlFileEntry | null;
  synced: boolean;
  counts?: Record<string, number>;
};

export type YamlValidateResponse = {
  success: boolean;
  root: string;
  issues?: YamlIssue[];
};

export type YamlCreatePathResponse = {
  success: boolean;
  path: string;
};
