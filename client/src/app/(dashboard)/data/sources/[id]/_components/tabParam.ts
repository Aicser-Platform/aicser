export type DetailTabKey = 'overview' | 'schema' | 'permissions' | 'row-filters' | 'column-rules';

const TAB_KEYS: DetailTabKey[] = ['overview', 'schema', 'permissions', 'row-filters', 'column-rules'];

export function parseTabParam(raw: string | null): DetailTabKey {
  return TAB_KEYS.includes(raw as DetailTabKey) ? (raw as DetailTabKey) : 'overview';
}
