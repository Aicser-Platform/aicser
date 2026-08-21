/**
 * One sentence form for row access, used everywhere it appears.
 *
 * Policies, rule rows and the access preview all describe a filter the same
 * way, so an admin learns the model by reading it repeatedly rather than by
 * decoding `fact_orders.customer_id = {project.customer_id}` each time.
 */

import type {
  DataSourceRLSOperator,
  DataSourceRLSValueType,
} from '@/api/dataSources';

export type DescribableRule = {
  table_name?: string;
  column_name?: string;
  operator?: DataSourceRLSOperator;
  value_type?: DataSourceRLSValueType;
  value?: unknown;
};

export type RuleDescription = {
  /** The column being restricted, e.g. fact_orders.customer_id */
  target: string;
  /** Plain-English comparison, e.g. "matches", "is any of" */
  verb: string;
  /** Whose value it is compared against, already phrased from the reader's side */
  scope: string;
  /** False while the rule is still half-built, so callers can stay silent */
  complete: boolean;
};

const EMPTINESS: Partial<Record<DataSourceRLSOperator, string>> = {
  is_null: 'is empty',
  is_not_null: 'is not empty',
};

const VERBS: Partial<Record<DataSourceRLSOperator, string>> = {
  eq: 'matches',
  in: 'is any of',
  not_in: 'is none of',
  between: 'falls between',
};

// Phrased as the reader would say it out loud, not as the schema names it.
const OWNER: Partial<Record<DataSourceRLSValueType, string>> = {
  user_attribute: 'their own',
  project_attribute: "their project's",
  org_attribute: "their organization's",
  group_attribute: "their group's",
};

const quote = (value: unknown) => `“${String(value)}”`;

export const describeRule = (rule: DescribableRule): RuleDescription => {
  const table = String(rule.table_name ?? '').trim();
  const column = String(rule.column_name ?? '').trim();
  const operator = (rule.operator ?? 'eq') as DataSourceRLSOperator;
  const valueType = (rule.value_type ?? 'user_attribute') as DataSourceRLSValueType;
  const target = table && column ? `${table}.${column}` : '';

  if (EMPTINESS[operator]) {
    return { target, verb: EMPTINESS[operator] as string, scope: '', complete: Boolean(target) };
  }

  const raw = rule.value;
  const hasValue = Array.isArray(raw) ? raw.length > 0 : String(raw ?? '').trim() !== '';

  let scope = '';
  if (hasValue) {
    if (valueType === 'fixed') {
      scope = Array.isArray(raw) ? raw.map(quote).join(', ') : quote(String(raw).trim());
    } else {
      scope = `${OWNER[valueType] ?? 'their own'} ${String(raw).trim()}`;
    }
  }

  return {
    target,
    verb: VERBS[operator] ?? 'matches',
    scope,
    complete: Boolean(target && hasValue),
  };
};

export const ruleSentence = (rule: DescribableRule): string => {
  const { target, verb, scope, complete } = describeRule(rule);
  if (!complete) return '';
  return `Show rows where ${target} ${verb}${scope ? ` ${scope}` : ''}`;
};

/**
 * Machine-side counterpart to OWNER: the path the enforcement engine reports
 * back in `unresolved`, e.g. "project.customer_id". Used to pin a warning to
 * the rule that caused it instead of listing paths in a separate column.
 */
const PATH_PREFIX: Partial<Record<DataSourceRLSValueType, string>> = {
  user_attribute: 'user',
  project_attribute: 'project',
  org_attribute: 'org',
  group_attribute: 'group',
};

export const attributePathFor = (rule: DescribableRule): string => {
  const prefix = PATH_PREFIX[(rule.value_type ?? 'user_attribute') as DataSourceRLSValueType];
  const key = String(rule.value ?? '').trim();
  if (!prefix || !key) return '';
  return `${prefix}.${key}`;
};

/** The unresolved path this rule is responsible for, or '' if it resolved. */
export const unresolvedForRule = (rule: DescribableRule, unresolved: string[]): string => {
  const path = attributePathFor(rule);
  if (!path) return '';
  return unresolved.includes(path) ? path : '';
};
