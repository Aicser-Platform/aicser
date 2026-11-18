// Ported from ../aicser/client/src/components/prep/ConditionBuilder.tsx @ 749d38d (logic only; see PORTING.md).
export type Condition = { column: string; op: string; value?: string; value2?: string };

export const CONDITION_OPS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'is_empty',
  'not_empty',
  'in_list',
  'matches',
] as const;

export const NO_VALUE = new Set(['is_empty', 'not_empty']);

export const conditionsComplete = (conds: Condition[]) =>
  conds.length > 0 &&
  conds.every(
    (c) =>
      c.column &&
      c.op &&
      (NO_VALUE.has(c.op) || (c.value ?? '').trim() !== '') &&
      (c.op !== 'between' || (c.value2 ?? '').trim() !== '')
  );
