/**
 * What a chart filter offers, from the column's own type (works for any data source): only the
 * operators that make sense for that kind of column, in plain words, and the value input that
 * fits the operator (date picker, number box, list of the column's values, free text, nothing).
 * Operator values stay the server's (`=`, `like`, `is_null`…).
 */

export type ColumnKind = 'date' | 'number' | 'boolean' | 'text';

export function columnKind(type: unknown): ColumnKind {
  const t = String(type ?? '').toLowerCase();
  if (/(date|time|timestamp)/.test(t)) return 'date';
  if (/^bool/.test(t)) return 'boolean';
  if (/(int|float|double|decimal|numeric|number|real|money)/.test(t)) return 'number';
  return 'text';
}

/** Operator value → dashboards message key, per kind (a date's "<" reads "before"). */
const OPERATORS: Record<ColumnKind, Array<[string, string]>> = {
  text: [
    ['=', 'filter_op_is'],
    ['!=', 'filter_op_is_not'],
    ['in', 'filter_op_is_one_of'],
    ['not_in', 'filter_op_is_none_of'],
    ['like', 'filter_op_contains'],
    ['is_not_null', 'filter_op_has_value'],
    ['is_null', 'filter_op_is_empty'],
  ],
  number: [
    ['=', 'filter_op_equals'],
    ['!=', 'filter_op_not_equals'],
    ['>', 'filter_op_more_than'],
    ['>=', 'filter_op_at_least'],
    ['<', 'filter_op_less_than'],
    ['<=', 'filter_op_at_most'],
    ['in', 'filter_op_is_one_of'],
    ['is_not_null', 'filter_op_has_value'],
    ['is_null', 'filter_op_is_empty'],
  ],
  date: [
    ['=', 'filter_op_on'],
    ['>=', 'filter_op_on_or_after'],
    ['>', 'filter_op_after'],
    ['<=', 'filter_op_on_or_before'],
    ['<', 'filter_op_before'],
    ['is_not_null', 'filter_op_has_value'],
    ['is_null', 'filter_op_is_empty'],
  ],
  boolean: [
    ['=', 'filter_op_is'],
    ['is_null', 'filter_op_is_empty'],
  ],
};

export function operatorsFor(kind: ColumnKind): Array<{ value: string; labelKey: string }> {
  return OPERATORS[kind].map(([value, labelKey]) => ({ value, labelKey }));
}

/** The label key for a saved filter's operator; operators from older filters still read. */
export function operatorLabelKey(kind: ColumnKind, operator: string): string | null {
  const hit = OPERATORS[kind].find(([v]) => v === operator) ?? OPERATORS.text.find(([v]) => v === operator);
  if (hit) return hit[1];
  if (operator === 'like_case') return 'filter_op_contains';
  return null;
}

export type ValueInput = 'none' | 'multi' | 'date' | 'number' | 'pick' | 'boolean' | 'text';

/**
 * The value control for this column and operator. `hasValues` is true when the column's distinct
 * values are known (a short list to pick from).
 */
export function valueInputFor(kind: ColumnKind, operator: string, hasValues: boolean): ValueInput {
  if (operator === 'is_null' || operator === 'is_not_null') return 'none';
  if (operator === 'in' || operator === 'not_in') return 'multi';
  if (kind === 'boolean') return 'boolean';
  if (kind === 'date') return 'date';
  if (kind === 'number') return (operator === '=' || operator === '!=') && hasValues ? 'pick' : 'number';
  if (operator === 'like' || operator === 'like_case') return 'text';
  return hasValues ? 'pick' : 'text';
}

/** Keep the operator when the new column's kind offers it, otherwise start from that kind's first. */
export function operatorForColumn(kind: ColumnKind, current: string): string {
  return OPERATORS[kind].some(([v]) => v === current) ? current : OPERATORS[kind][0][0];
}
