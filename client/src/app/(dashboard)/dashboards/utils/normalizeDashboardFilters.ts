import type { DashboardFilter } from '@/types/dashboard';
import { presetRangeByKey, type DatePresetKey } from './dateFilterPresets';

type RawDashboardFilter = Partial<DashboardFilter> & {
  label?: unknown;
  default?: unknown;
  multi?: unknown;
  type?: unknown;
};

type FilterDataContext = {
  dataSourceId?: string;
  tableName?: string;
};

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

    return [
      {
        ...filter,
        id: (typeof filter.id === 'string' && filter.id.trim()) || `dashboard_filter_${index}_${field}`,
        field,
        name,
        type,
        defaultValue: normalizeDefault(type, defaultValue),
        isGlobal: filter.isGlobal ?? true,
        dataSourceId: filter.dataSourceId || context.dataSourceId,
        tableName: filter.tableName || context.tableName,
      } as DashboardFilter,
    ];
  });
}
