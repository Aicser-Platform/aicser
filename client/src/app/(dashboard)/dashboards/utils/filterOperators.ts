import type { DashboardFilter } from '@/types/dashboard';

/** Count distinct filtered fields (date range = 1 field). */
export function countActiveFilterFields(filters: RuntimeFilter[]): number {
  return new Set(filters.map((f) => f.field).filter(Boolean)).size;
}

/** Active cross-filter / slicer values for a chart dimension field. */
export function getCrossFilterValues(runtimeFilters: RuntimeFilter[], field?: string): string[] {
  if (!field) return [];
  const match = runtimeFilters.find(
    (f) => f.field === field && (f.operator === '=' || f.operator === 'in')
  );
  if (!match) return [];
  if (match.operator === 'in') {
    if (Array.isArray(match.value)) return match.value.map(String);
    return String(match.value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return match.value != null && match.value !== '' ? [String(match.value)] : [];
}

/**
 * Apply global filter scope (`affects`) per widget.
 * Runtime filters from cross-filter / slicer (not in global config) always apply.
 */
export function resolveRuntimeFiltersForWidget(
  runtimeFilters: RuntimeFilter[],
  globalFilterConfig: DashboardFilter[],
  widget: { id: string; chartId?: string }
): RuntimeFilter[] {
  if (!runtimeFilters.length) return runtimeFilters;
  const configByField = new Map(globalFilterConfig.filter((f) => f.field).map((f) => [f.field, f]));
  const widgetKeys = new Set([widget.id, widget.chartId].filter(Boolean) as string[]);

  return runtimeFilters.filter((rf) => {
    const cfg = configByField.get(rf.field);
    if (!cfg) return true;
    const scope = cfg.affects;
    if (!scope?.length) return true;
    return scope.some((id) => widgetKeys.has(id));
  });
}

/** Build runtime filters from dashboard filter config defaults. */
export function buildDefaultRuntimeFilters(
  config: Array<{
    field: string;
    type?: string;
    defaultValue?: unknown;
    numericMin?: number;
    numericMax?: number;
  }>,
): RuntimeFilter[] {
  const out: RuntimeFilter[] = [];
  for (const f of config) {
    if (!f.field || f.defaultValue == null || f.defaultValue === '') continue;
    if (f.type === 'dateRange' && Array.isArray(f.defaultValue)) {
      const [from, to] = f.defaultValue;
      if (from) out.push({ field: f.field, operator: '>=', value: from, type: 'date' });
      if (to) out.push({ field: f.field, operator: '<=', value: to, type: 'date' });
    } else if (f.type === 'date' && typeof f.defaultValue === 'string') {
      out.push({ field: f.field, operator: '>=', value: f.defaultValue, type: 'date' });
      out.push({ field: f.field, operator: '<=', value: f.defaultValue, type: 'date' });
    } else if (f.type === 'slider' && Array.isArray(f.defaultValue)) {
      const [lo, hi] = f.defaultValue;
      if (lo != null && lo !== '') out.push({ field: f.field, operator: '>=', value: lo, type: 'simple' });
      if (hi != null && hi !== '') out.push({ field: f.field, operator: '<=', value: hi, type: 'simple' });
    } else if (f.type === 'checkbox' && Array.isArray(f.defaultValue) && f.defaultValue.length) {
      out.push({ field: f.field, operator: 'in', value: f.defaultValue, type: 'simple' });
    } else {
      out.push({ field: f.field, operator: '=', value: f.defaultValue, type: 'simple' });
    }
  }
  return out;
}

export type FilterOptionsRequest = {
  embedToken?: string;
  tableName?: string;
  runtimeFilters?: RuntimeFilter[];
  excludeField?: string;
};

/** Runtime filter shape used in dashboard UI and API payloads. */
export type RuntimeFilter = {
  field: string;
  operator: string;
  value: unknown;
  type?: string;
};

const BACKEND_OPERATORS = new Set([
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'like',
  'like_case',
  'in',
  'not_in',
  'is_null',
  'is_not_null',
]);

/** Convert UI/runtime filters to operators accepted by chart SQL builder. */
export function normalizeRuntimeFiltersForBackend(filters: RuntimeFilter[]): RuntimeFilter[] {
  const out: RuntimeFilter[] = [];
  for (const f of filters) {
    if (!f.field) continue;
    const op = (f.operator || 'eq').toLowerCase();
    const val = f.value;

    if (op === 'eq' || op === 'equals') {
      out.push({ ...f, operator: '=' });
      continue;
    }
    if (op === 'contains' || op === 'search') {
      const str = String(val ?? '');
      if (!str) continue;
      const likeVal = str.includes('%') ? str : `%${str}%`;
      out.push({ ...f, operator: 'like', value: likeVal });
      continue;
    }
    if (op === 'between' && Array.isArray(val)) {
      const [from, to] = val;
      if (from) out.push({ field: f.field, operator: '>=', value: from, type: f.type || 'date' });
      if (to) out.push({ field: f.field, operator: '<=', value: to, type: f.type || 'date' });
      continue;
    }
    if (op === 'in' || op === 'not_in') {
      if (Array.isArray(val)) {
        out.push({ ...f, operator: op });
      } else if (val != null && val !== '') {
        out.push({ ...f, operator: op, value: val });
      }
      continue;
    }
    if (BACKEND_OPERATORS.has(f.operator)) {
      out.push(f);
      continue;
    }
    if (val !== undefined && val !== null && val !== '') {
      out.push({ ...f, operator: '=' });
    }
  }
  return out;
}

/** Extract filter-options values array from API response. */
export function unwrapFilterOptionsResponse(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (response && typeof response === 'object') {
    const obj = response as Record<string, unknown>;
    if (Array.isArray(obj.values)) return obj.values;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.options)) return obj.options;
  }
  return [];
}

export type NormalizedFilterOption = { label: string; value: string; type?: string };

/** Normalize API/schema filter values for Ant Design Select (string or {label,value,type}). */
export function normalizeFilterOptions(items: unknown[]): NormalizedFilterOption[] {
  const out: NormalizedFilterOption[] = [];
  for (const item of items) {
    if (item == null) continue;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const s = String(item);
      if (s) out.push({ label: s, value: s });
      continue;
    }
    if (typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const value = obj.value ?? obj.name ?? obj.label;
      if (value == null || value === '') continue;
      const label = obj.label ?? obj.name ?? value;
      out.push({
        label: String(label),
        value: String(value),
        ...(obj.type != null ? { type: String(obj.type) } : {}),
      });
    }
  }
  return out;
}

/** Read date-range bounds from runtime filters for a field. */
export function getDateRangeValue(
  field: string,
  runtimeFilters: RuntimeFilter[],
): [string | null, string | null] {
  const from = runtimeFilters.find((f) => f.field === field && f.operator === '>=')?.value;
  const to = runtimeFilters.find((f) => f.field === field && f.operator === '<=')?.value;
  if (from || to) return [from ? String(from) : null, to ? String(to) : null];
  const between = runtimeFilters.find((f) => f.field === field && f.operator === 'between');
  if (Array.isArray(between?.value)) {
    return [between.value[0] ? String(between.value[0]) : null, between.value[1] ? String(between.value[1]) : null];
  }
  return [null, null];
}

/** Single-date filter value (uses range endpoints when both equal). */
export function getSingleDateValue(field: string, runtimeFilters: RuntimeFilter[]): string | null {
  const eq = runtimeFilters.find((f) => f.field === field && f.operator === '=');
  if (eq?.value != null && eq.value !== '') return String(eq.value);
  const [from, to] = getDateRangeValue(field, runtimeFilters);
  if (from && to && from === to) return from;
  return from || to;
}

/** Numeric slider range from runtime filters. */
export function getNumericRangeValue(
  field: string,
  runtimeFilters: RuntimeFilter[],
  fallbackMin = 0,
  fallbackMax = 100,
): [number, number] {
  const min = runtimeFilters.find((f) => f.field === field && f.operator === '>=');
  const max = runtimeFilters.find((f) => f.field === field && f.operator === '<=');
  return [
    min?.value !== undefined && min.value !== '' ? Number(min.value) : fallbackMin,
    max?.value !== undefined && max.value !== '' ? Number(max.value) : fallbackMax,
  ];
}
