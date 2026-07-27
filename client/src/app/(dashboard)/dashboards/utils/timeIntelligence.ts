/**
 * Shared time-intelligence helpers for dashboards, filters, and KPI PoP.
 * Calendar is Gregorian; optional fiscalYearStartMonth (1–12) for fiscal periods.
 */

import dayjs, { type Dayjs } from 'dayjs';

export type ComparisonPeriod = 'wow' | 'mom' | 'qoq' | 'yoy';

export type TimeIntelligenceOptions = {
  /** Reserved for org timezone; currently uses local browser clock. */
  timeZone?: string | null;
  /** Month number 1–12 when fiscal year starts. Default 1 (calendar year). */
  fiscalYearStartMonth?: number;
};

export const COMPARISON_PERIOD_LABELS: Record<ComparisonPeriod, string> = {
  wow: 'last week',
  mom: 'last month',
  qoq: 'last quarter',
  yoy: 'last year',
};

function nowInZone(_opts?: TimeIntelligenceOptions): Dayjs {
  // Local clock today; wire org TZ when dashboard settings expose it.
  return dayjs();
}

function quarterStartMonth(d: Dayjs, fiscalStart = 1): number {
  const m = d.month(); // 0-based
  const fiscalOffset = ((m - (fiscalStart - 1)) % 12 + 12) % 12;
  const qIndex = Math.floor(fiscalOffset / 3);
  return (fiscalStart - 1 + qIndex * 3) % 12;
}

/** Month-to-date: start of month → today */
export function rangeMtd(opts?: TimeIntelligenceOptions): { from: string; to: string } {
  const n = nowInZone(opts);
  return { from: n.startOf('month').format('YYYY-MM-DD'), to: n.format('YYYY-MM-DD') };
}

/** Quarter-to-date (calendar or fiscal) → today */
export function rangeQtd(opts?: TimeIntelligenceOptions): { from: string; to: string } {
  const n = nowInZone(opts);
  const fiscalStart = opts?.fiscalYearStartMonth ?? 1;
  const qStart = quarterStartMonth(n, fiscalStart);
  const from = n.month(qStart).startOf('month');
  return { from: from.format('YYYY-MM-DD'), to: n.format('YYYY-MM-DD') };
}

/** Year-to-date (calendar or fiscal) → today */
export function rangeYtd(opts?: TimeIntelligenceOptions): { from: string; to: string } {
  const n = nowInZone(opts);
  const fiscalStart = opts?.fiscalYearStartMonth ?? 1;
  if (fiscalStart <= 1) {
    return { from: n.startOf('year').format('YYYY-MM-DD'), to: n.format('YYYY-MM-DD') };
  }
  const month = n.month() + 1;
  let fyStart = n.month(fiscalStart - 1).startOf('month');
  if (month < fiscalStart) {
    fyStart = fyStart.subtract(1, 'year');
  }
  return { from: fyStart.format('YYYY-MM-DD'), to: n.format('YYYY-MM-DD') };
}

/**
 * Shift an inclusive date range backward by a comparison period.
 * Preserves duration for wow (7d) and uses calendar month/quarter/year for others.
 */
export function shiftDateRangeForComparison(
  from: string,
  to: string,
  period: ComparisonPeriod,
): { from: string; to: string } {
  const start = dayjs(from);
  const end = dayjs(to);
  if (!start.isValid() || !end.isValid()) {
    return { from, to };
  }

  switch (period) {
    case 'wow':
      return {
        from: start.subtract(7, 'day').format('YYYY-MM-DD'),
        to: end.subtract(7, 'day').format('YYYY-MM-DD'),
      };
    case 'mom':
      return {
        from: start.subtract(1, 'month').format('YYYY-MM-DD'),
        to: end.subtract(1, 'month').format('YYYY-MM-DD'),
      };
    case 'qoq':
      return {
        from: start.subtract(3, 'month').format('YYYY-MM-DD'),
        to: end.subtract(3, 'month').format('YYYY-MM-DD'),
      };
    case 'yoy':
      return {
        from: start.subtract(1, 'year').format('YYYY-MM-DD'),
        to: end.subtract(1, 'year').format('YYYY-MM-DD'),
      };
    default:
      return { from, to };
  }
}

type FilterLike = {
  field?: string;
  operator?: string;
  value?: unknown;
  [key: string]: unknown;
};

function isDateLikeString(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim());
}

/**
 * Shift >= / <= date filters for period-over-period. Returns null if no date bounds found.
 */
export function shiftFiltersForComparison(
  filters: FilterLike[] | null | undefined,
  period: ComparisonPeriod,
): FilterLike[] | null {
  if (!Array.isArray(filters) || filters.length === 0) return null;

  let from: string | null = null;
  let to: string | null = null;
  let fromField: string | null = null;
  let toField: string | null = null;

  for (const f of filters) {
    const op = String(f.operator || '').trim();
    if ((op === '>=' || op === '>') && isDateLikeString(f.value)) {
      from = String(f.value).slice(0, 10);
      fromField = String(f.field || '');
    }
    if ((op === '<=' || op === '<') && isDateLikeString(f.value)) {
      to = String(f.value).slice(0, 10);
      toField = String(f.field || '');
    }
    if (op === 'between' && Array.isArray(f.value) && f.value.length >= 2) {
      if (isDateLikeString(f.value[0]) && isDateLikeString(f.value[1])) {
        from = String(f.value[0]).slice(0, 10);
        to = String(f.value[1]).slice(0, 10);
        fromField = toField = String(f.field || '');
      }
    }
  }

  if (!from || !to) return null;
  if (fromField && toField && fromField !== toField) return null;

  const shifted = shiftDateRangeForComparison(from, to, period);

  return filters.map((f) => {
    const op = String(f.operator || '').trim();
    if ((op === '>=' || op === '>') && isDateLikeString(f.value)) {
      return { ...f, value: shifted.from };
    }
    if ((op === '<=' || op === '<') && isDateLikeString(f.value)) {
      return { ...f, value: shifted.to };
    }
    if (op === 'between' && Array.isArray(f.value) && f.value.length >= 2) {
      if (isDateLikeString(f.value[0]) && isDateLikeString(f.value[1])) {
        return { ...f, value: [shifted.from, shifted.to] };
      }
    }
    return f;
  });
}

export function isComparisonPeriod(v: unknown): v is ComparisonPeriod {
  return v === 'wow' || v === 'mom' || v === 'qoq' || v === 'yoy';
}
