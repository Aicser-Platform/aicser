/**
 * Why a widget shows no data, in words that point at the right fix. One generic
 * "Data unavailable — try refreshing" used to cover all of these, which sent people
 * to Refresh when the widget simply had no data picked, or they lacked access.
 */
export type WidgetErrorKind =
  | 'not_connected'
  | 'no_access'
  | 'other_project'
  | 'field'
  | 'query'
  | 'timeout'
  | 'load_failed';

export type Translate = (key: string, values?: Record<string, string | number>) => string;

const has = (s: string, parts: string[]) => parts.some((p) => s.includes(p));

export function classifyWidgetError(error?: string | null): WidgetErrorKind {
  const lower = (typeof error === 'string' ? error : '').trim().toLowerCase();
  if (!lower) return 'load_failed';
  if (has(lower, ['no chartid', 'no data source', 'no datasource', 'not bound', 'no table selected', 'missing x', 'no fields'])) {
    return 'not_connected';
  }
  // Data stays in its project: a chart pointing at another project's source is refused.
  if (has(lower, ['data source from another project', 'belongs to another project'])) return 'other_project';
  if (has(lower, ['403', 'forbidden', 'no access', 'access denied', 'permission', 'not authorized', 'unauthorized'])) {
    return 'no_access';
  }
  if (has(lower, ['referenced column', 'binder error', 'not found in from clause', 'candidate bindings', 'column not found', 'no such column'])) {
    return 'field';
  }
  if (has(lower, ['timeout', 'timed out', 'deadline'])) return 'timeout';
  if (has(lower, ['query execution failed', 'syntax error', 'sql'])) return 'query';
  return 'load_failed';
}

export function getFriendlyWidgetError(
  error: string | null | undefined,
  t: Translate,
): { kind: WidgetErrorKind; title: string; detail: string; technicalDetail?: string; retryable: boolean } {
  const technicalDetail = typeof error === 'string' && error.trim() ? error.trim() : undefined;
  const kind = classifyWidgetError(error);
  return {
    kind,
    title: t(`widget_error_${kind}_title`),
    detail: t(`widget_error_${kind}_detail`),
    technicalDetail: kind === 'not_connected' ? undefined : technicalDetail,
    // Retrying cannot fix a missing binding or missing access.
    retryable: kind !== 'not_connected' && kind !== 'no_access' && kind !== 'other_project',
  };
}
