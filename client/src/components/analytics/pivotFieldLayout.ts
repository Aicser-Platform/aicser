import type { Agg, PivotSpec } from '@/app/(dashboard)/notebooks/components/chartShape';

export type PivotZone = 'rows' | 'columns' | 'values' | 'filters';

export type PivotFieldLayout = {
  rows: string[];
  columns: string[];
  values: string[];
  filters: string[];
  /** Empty array for a filter field means “all values”. */
  filterValues: Record<string, string[]>;
  agg: Agg;
  valueAggs: Record<string, Agg>;
};

export const emptyPivotLayout: PivotFieldLayout = {
  rows: [],
  columns: [],
  values: [],
  filters: [],
  filterValues: {},
  agg: 'sum',
  valueAggs: {},
};

export function usedInPivot(layout: PivotFieldLayout, field: string): PivotZone | null {
  if (layout.rows.includes(field)) return 'rows';
  if (layout.columns.includes(field)) return 'columns';
  if (layout.values.includes(field)) return 'values';
  if (layout.filters.includes(field)) return 'filters';
  return null;
}

export function removeFieldFromPivot(layout: PivotFieldLayout, field: string): PivotFieldLayout {
  const { [field]: _fv, ...restFv } = layout.filterValues;
  const { [field]: _va, ...restVa } = layout.valueAggs;
  return {
    ...layout,
    rows: layout.rows.filter((f) => f !== field),
    columns: layout.columns.filter((f) => f !== field),
    values: layout.values.filter((f) => f !== field),
    filters: layout.filters.filter((f) => f !== field),
    filterValues: restFv,
    valueAggs: restVa,
  };
}

function zoneList(layout: PivotFieldLayout, zone: PivotZone): string[] {
  if (zone === 'rows') return layout.rows;
  if (zone === 'columns') return layout.columns;
  if (zone === 'values') return layout.values;
  return layout.filters;
}

export function assignFieldToPivotZone(
  layout: PivotFieldLayout,
  field: string,
  zone: PivotZone,
  index?: number,
): PivotFieldLayout {
  const base = removeFieldFromPivot(layout, field);
  const list = [...zoneList(base, zone)];
  const at = index == null || index < 0 || index > list.length ? list.length : index;
  list.splice(at, 0, field);
  const next: PivotFieldLayout = { ...base };
  if (zone === 'rows') next.rows = list;
  else if (zone === 'columns') next.columns = list;
  else if (zone === 'values') next.values = list;
  else {
    next.filters = list;
    if (!next.filterValues[field]) next.filterValues = { ...next.filterValues, [field]: [] };
  }
  return next;
}

export function reorderInPivotZone(layout: PivotFieldLayout, zone: PivotZone, from: number, to: number): PivotFieldLayout {
  const list = [...zoneList(layout, zone)];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return layout;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  const next = { ...layout };
  if (zone === 'rows') next.rows = list;
  else if (zone === 'columns') next.columns = list;
  else if (zone === 'values') next.values = list;
  else next.filters = list;
  return next;
}

export function layoutToPivotSpec(layout: PivotFieldLayout): PivotSpec {
  const values = layout.values.length ? layout.values : [];
  const agg = values.length ? layout.agg : 'count';
  return {
    rows: layout.rows,
    columns: layout.columns,
    values,
    filters: layout.filters,
    filterValues: layout.filterValues,
    agg,
    valueAggs: Object.keys(layout.valueAggs).length ? layout.valueAggs : undefined,
  };
}

export function aggForValueField(layout: PivotFieldLayout, field: string): Agg {
  return layout.valueAggs[field] ?? layout.agg;
}

export type ChartZone = 'category' | 'series' | 'values';

export type ChartFieldLayout = {
  category: string | null;
  series: string | null;
  values: string[];
  agg: Agg;
  valueAggs: Record<string, Agg>;
};

export const emptyChartLayout: ChartFieldLayout = {
  category: null,
  series: null,
  values: [],
  agg: 'sum',
  valueAggs: {},
};

export function usedInChart(layout: ChartFieldLayout, field: string): ChartZone | null {
  if (layout.category === field) return 'category';
  if (layout.series === field) return 'series';
  if (layout.values.includes(field)) return 'values';
  return null;
}

export function removeFieldFromChart(layout: ChartFieldLayout, field: string): ChartFieldLayout {
  const { [field]: _va, ...restVa } = layout.valueAggs;
  return {
    ...layout,
    category: layout.category === field ? null : layout.category,
    series: layout.series === field ? null : layout.series,
    values: layout.values.filter((f) => f !== field),
    valueAggs: restVa,
  };
}

export function assignFieldToChartZone(
  layout: ChartFieldLayout,
  field: string,
  zone: ChartZone,
  index?: number,
): ChartFieldLayout {
  const base = removeFieldFromChart(layout, field);
  if (zone === 'category') return { ...base, category: field };
  if (zone === 'series') return { ...base, series: field };
  const list = [...base.values];
  const at = index == null || index < 0 || index > list.length ? list.length : index;
  list.splice(at, 0, field);
  return { ...base, values: list };
}
