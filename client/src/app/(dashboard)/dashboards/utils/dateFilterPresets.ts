import dayjs from 'dayjs';
import { rangeMtd, rangeQtd, rangeYtd } from './timeIntelligence';

export type DatePresetKey =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'mtd'
  | 'qtd'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQtr'
  | 'lastQtr'
  | 'thisYear'
  | 'ytd'
  | 'custom';

export type DatePresetDefinition = {
  key: DatePresetKey;
  /** i18n key under dashboards namespace */
  labelKey: string;
  from: () => string;
  to: () => string;
};

export const DATE_PRESET_DEFINITIONS: DatePresetDefinition[] = [
  {
    key: 'today',
    labelKey: 'date_preset_today',
    from: () => dayjs().startOf('day').format('YYYY-MM-DD'),
    to: () => dayjs().endOf('day').format('YYYY-MM-DD'),
  },
  {
    key: 'yesterday',
    labelKey: 'date_preset_yesterday',
    from: () => dayjs().subtract(1, 'day').startOf('day').format('YYYY-MM-DD'),
    to: () => dayjs().subtract(1, 'day').endOf('day').format('YYYY-MM-DD'),
  },
  {
    key: 'last7',
    labelKey: 'date_preset_last7',
    from: () => dayjs().subtract(6, 'day').format('YYYY-MM-DD'),
    to: () => dayjs().format('YYYY-MM-DD'),
  },
  {
    key: 'last30',
    labelKey: 'date_preset_last30',
    from: () => dayjs().subtract(29, 'day').format('YYYY-MM-DD'),
    to: () => dayjs().format('YYYY-MM-DD'),
  },
  {
    key: 'mtd',
    labelKey: 'date_preset_mtd',
    from: () => rangeMtd().from,
    to: () => rangeMtd().to,
  },
  {
    key: 'qtd',
    labelKey: 'date_preset_qtd',
    from: () => rangeQtd().from,
    to: () => rangeQtd().to,
  },
  {
    // Alias of MTD for existing dashboards — ends at today (not end of month)
    key: 'thisMonth',
    labelKey: 'date_preset_this_month',
    from: () => rangeMtd().from,
    to: () => rangeMtd().to,
  },
  {
    key: 'lastMonth',
    labelKey: 'date_preset_last_month',
    from: () => dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD'),
    to: () => dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD'),
  },
  {
    // Alias of QTD — ends at today
    key: 'thisQtr',
    labelKey: 'date_preset_this_qtr',
    from: () => rangeQtd().from,
    to: () => rangeQtd().to,
  },
  {
    key: 'lastQtr',
    labelKey: 'date_preset_last_qtr',
    from: () => {
      const now = dayjs();
      const curQStart = Math.floor(now.month() / 3) * 3;
      const prevQ = now.month(curQStart).subtract(1, 'month');
      const prevQStart = Math.floor(prevQ.month() / 3) * 3;
      return prevQ.month(prevQStart).startOf('month').format('YYYY-MM-DD');
    },
    to: () => {
      const now = dayjs();
      const curQStart = Math.floor(now.month() / 3) * 3;
      const prevQ = now.month(curQStart).subtract(1, 'month');
      const prevQStart = Math.floor(prevQ.month() / 3) * 3;
      return prevQ.month(prevQStart + 2).endOf('month').format('YYYY-MM-DD');
    },
  },
  {
    key: 'thisYear',
    labelKey: 'date_preset_this_year',
    from: () => dayjs().startOf('year').format('YYYY-MM-DD'),
    to: () => dayjs().format('YYYY-MM-DD'),
  },
  {
    key: 'ytd',
    labelKey: 'date_preset_ytd',
    from: () => rangeYtd().from,
    to: () => rangeYtd().to,
  },
  {
    key: 'custom',
    labelKey: 'date_preset_custom',
    from: () => '',
    to: () => '',
  },
];

export type ResolvedDatePreset = DatePresetDefinition & { label: string };

export function resolveDatePresets(t: (key: string) => string): ResolvedDatePreset[] {
  return DATE_PRESET_DEFINITIONS.map((p) => ({ ...p, label: t(p.labelKey) }));
}

export function detectDatePresetKey(from: string | null | undefined, to: string | null | undefined): DatePresetKey | null {
  if (!from && !to) return null;
  for (const p of DATE_PRESET_DEFINITIONS) {
    if (p.key === 'custom') continue;
    if (p.from() === from && p.to() === to) return p.key;
  }
  return 'custom';
}

export function presetRangeByKey(key: DatePresetKey): { from: string; to: string } {
  const preset = DATE_PRESET_DEFINITIONS.find((p) => p.key === key);
  if (!preset) return { from: '', to: '' };
  return { from: preset.from(), to: preset.to() };
}
