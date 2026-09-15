import type { DashboardFilter } from '@/types/dashboard';
import { presetRangeByKey, type DatePresetKey } from './dateFilterPresets';

type RawDashboardFilter = Partial<DashboardFilter> & {
  label?: unknown;
  default?: unknown;
  multi?: unknown;
  type?: unknown;
};

type FilterContextWidget = {
  dataSourceId?: string;
  chartQuery?: Record<string, unknown>;
};

type FilterDataContext = {
  dataSourceId?: string;
  tableName?: string;
  /**
   * All dashboard widgets, used to resolve each filter's own data source by
   * which widget's chartQuery actually references its field - a dashboard
   * spanning more than one table can't correctly bind every filter to
   * whichever widget happens to be first (the flat dataSourceId/tableName
   * fallback above). Falls back to that flat context when no widget
   * references the field (e.g. a brand-new filter not yet used anywhere).
   */
  widgets?: FilterContextWidget[];
};

function metricListHasField(list: unknown, field: string): boolean {
  return Array.isArray(list) && list.some((m) => m && typeof m === 'object' && (m as { field?: unknown }).field === field);
}

function widgetReferencesField(widget: FilterContextWidget, field: string): boolean {
  const cq = widget.chartQuery;
  if (!cq) return false;
  if (cq.x === field || cq.groupField === field) return true;
  return (
    metricListHasField(cq.yMetrics, field) ||
    metricListHasField(cq.yMetricsSecondary, field) ||
    metricListHasField(cq.xMetrics, field)
  );
}

function resolveFieldContext(field: string, context: FilterDataContext): { dataSourceId?: string; tableName?: string } {
  const match = context.widgets?.find((w) => w.dataSourceId && widgetReferencesField(w, field));
  if (match) {
    return { dataSourceId: match.dataSourceId, tableName: match.chartQuery?.tableName as string | undefined };
  }
  return { dataSourceId: context.dataSourceId, tableName: context.tableName };
}

const DATE_PRESET_ALIASES: Record<string, DatePresetKey> = {
  today: 'today',
  yesterday: 'yesterday',
  last_7_days: 'last7',
  last7: 'last7',
  last_30_days: 'last30',
  last30: 'last30',
  mtd: 'mtd',
  qtd: 'qtd',
  this_month: 'thisMonth',
  last_month: 'lastMonth',
  this_quarter: 'thisQtr',
  last_quarter: 'lastQtr',
  this_year: 'thisYear',
  ytd: 'ytd',
};

function normalizeType(type: unknown, multi: unknown): DashboardFilter['type'] {
  switch (String(type || '').trim()) {
    case 'date_range':
    case 'dateRange':
      return 'dateRange';
    case 'date':
      return 'date';
    case 'slider':
    case 'numeric_range':
      return 'slider';
    case 'search':
      return 'search';
    case 'checkbox':
      return 'checkbox';
    case 'select':
      return multi === true ? 'checkbox' : 'dropdown';
    case 'dropdown':
      return 'dropdown';
    default:
      return multi === true ? 'checkbox' : 'dropdown';
  }
}

function normalizeDefault(type: DashboardFilter['type'], value: unknown): unknown {
  if (type !== 'dateRange' || typeof value !== 'string') return value;
  const preset = DATE_PRESET_ALIASES[value.trim()];
  if (!preset) return value;
  const range = presetRangeByKey(preset);
  return [range.from, range.to];
}

export function normalizeDashboardFilters(raw: unknown, context: FilterDataContext = {}): DashboardFilter[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const filter = entry as RawDashboardFilter;
    const field = typeof filter.field === 'string' ? filter.field.trim() : '';
    if (!field) return [];

    const type = normalizeType(filter.type, filter.multi);
    const name =
      (typeof filter.name === 'string' && filter.name.trim()) ||
      (typeof filter.label === 'string' && filter.label.trim()) ||
      field.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    const defaultValue = filter.defaultValue ?? filter.default;
    const fieldContext = resolveFieldContext(field, context);

    return [
      {
        ...filter,
        id: (typeof filter.id === 'string' && filter.id.trim()) || `dashboard_filter_${index}_${field}`,
        field,
        name,
        type,
        defaultValue: normalizeDefault(type, defaultValue),
        isGlobal: filter.isGlobal ?? true,
        dataSourceId: filter.dataSourceId || fieldContext.dataSourceId,
        tableName: filter.tableName || fieldContext.tableName,
      } as DashboardFilter,
    ];
  });
}
