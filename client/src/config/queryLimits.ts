/**
 * Query/row limit constants for the client.
 * Align with server app.common.query_limits (DEFAULT_QUERY_LIMIT = 1000)
 * so SQL editor default and backend defaults are consistent.
 */
export const DEFAULT_QUERY_LIMIT = 1000;

export const ROW_LIMIT_PRESETS = [
  { value: '100', label: '100' },
  { value: '500', label: '500' },
  { value: '1000', label: '1,000' },
  { value: '5000', label: '5,000' },
  { value: '10000', label: '10,000' },
  { value: 'all', label: 'All' },
] as const;
