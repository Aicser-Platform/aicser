import type { DashboardFilter } from '@/types/dashboard';

export type ColumnMeta = {
  name: string;
  type?: string;
};

const DATE_NAME_HINTS = /(_at$|^date|^time|timestamp|created|updated|value_date|period)/i;
const NUMERIC_TYPES = /int|float|double|decimal|numeric|number|real/i;
const DATE_TYPES = /date|time|timestamp/i;

/** Infer dashboard filter control type from column metadata. */
export function inferFilterTypeFromColumn(
  column: ColumnMeta,
  opts?: { cardinalityHint?: 'low' | 'high' },
): DashboardFilter['type'] {
  const colType = (column.type || '').toLowerCase();
  const name = column.name || '';

  if (DATE_TYPES.test(colType) || DATE_NAME_HINTS.test(name)) {
    return 'dateRange';
  }
  if (NUMERIC_TYPES.test(colType)) {
    return 'slider';
  }
  if (opts?.cardinalityHint === 'high') {
    return 'search';
  }
  return 'dropdown';
}

/** Human-readable default label from field name. */
export function inferFilterLabel(field: string): string {
  const cleaned = field.replace(/_/g, ' ').trim();
  if (!cleaned) return 'Filter';
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Suggested default runtime value for a new filter definition. */
export function inferDefaultFilterValue(type: DashboardFilter['type']): unknown {
  switch (type) {
    case 'dateRange': {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 30);
      return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)];
    }
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'slider':
      return [0, 100];
    case 'checkbox':
      return [];
    case 'search':
      return '';
    case 'dropdown':
    default:
      return undefined;
  }
}

/** Build a smart filter draft from column selection. */
export function buildSmartFilterDraft(params: {
  field: string;
  columnType?: string;
  dataSourceId?: string;
  tableName?: string;
  widgets?: Array<{ id: string }>;
  widgetIdsUsingField?: string[];
}): DashboardFilter {
  const type = inferFilterTypeFromColumn({ name: params.field, type: params.columnType });
  const defaultValue = inferDefaultFilterValue(type);
  const affects =
    params.widgetIdsUsingField && params.widgetIdsUsingField.length > 0
      ? params.widgetIdsUsingField
      : undefined;

  return {
    id: `filter_${params.field}_${Date.now()}`,
    name: inferFilterLabel(params.field),
    type,
    field: params.field,
    ...(params.dataSourceId ? { dataSourceId: params.dataSourceId } : {}),
    ...(params.tableName ? { tableName: params.tableName } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(type === 'dateRange' ? { displayWidth: 'lg' as const } : {}),
    ...(affects?.length ? { affects } : {}),
    isGlobal: true,
  };
}
