import { label } from '@/app/(dashboard)/notebooks/components/chartShape';

/** Distinct display labels for a column (for filter pickers). */
export function distinctColumnValues(columns: string[], rows: unknown[][], field: string, cap = 200): string[] {
  const i = columns.indexOf(field);
  if (i < 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const v = label(r[i]);
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= cap) break;
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return out;
}

/** Keep rows that match filter field selections (empty selection = all values). */
export function applyPivotFilters(
  columns: string[],
  rows: unknown[][],
  filterFields: string[],
  filterValues: Record<string, string[]>,
): unknown[][] {
  if (!filterFields.length) return rows;
  return rows.filter((r) => {
    for (const field of filterFields) {
      const colIdx = columns.indexOf(field);
      if (colIdx < 0) continue;
      const allowed = filterValues[field];
      if (!allowed || allowed.length === 0) continue;
      if (!allowed.includes(label(r[colIdx]))) return false;
    }
    return true;
  });
}
