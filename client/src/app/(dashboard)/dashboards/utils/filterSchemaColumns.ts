import type { DashboardFilter } from '@/types/dashboard';

export type SchemaColumnOption = {
  label: string;
  value: string;
  type?: string;
};

type SchemaTable = {
  name?: string;
  columns?: Array<{ name?: string; type?: string } | string>;
};

type DataSourceWithSchema = {
  id: string | number;
  schema?: { tables?: SchemaTable[] };
};

function columnsFromTable(table?: SchemaTable | null): SchemaColumnOption[] {
  if (!table?.columns?.length) return [];
  return table.columns
    .map((col) => {
      if (typeof col === 'string') return { label: col, value: col, type: 'string' };
      const name = col?.name;
      if (!name) return null;
      return { label: name, value: name, type: col.type || 'string' };
    })
    .filter(Boolean) as SchemaColumnOption[];
}

/** Column options for a data source + optional table (used by filter editor & slicer properties). */
export function getColumnsForDataSource(
  dataSources: DataSourceWithSchema[],
  dataSourceId?: string,
  tableName?: string,
): SchemaColumnOption[] {
  if (!dataSourceId) return [];
  const ds = dataSources.find((d) => String(d.id) === String(dataSourceId));
  const tables = ds?.schema?.tables || [];
  if (!tables.length) return [];

  const table =
    (tableName ? tables.find((t) => t.name === tableName) : null) ||
    tables.find((t) => t.name === 'data') ||
    tables.find((t) => t.columns && t.columns.length > 0) ||
    tables[0];

  return columnsFromTable(table);
}

/** Find which table owns a column (for filter / slicer field binding). */
export function resolveTableForField(
  dataSources: DataSourceWithSchema[],
  dataSourceId?: string,
  field?: string,
): string | undefined {
  if (!dataSourceId || !field) return undefined;
  const ds = dataSources.find((d) => String(d.id) === String(dataSourceId));
  const tables = ds?.schema?.tables || [];
  for (const tbl of tables) {
    const cols = columnsFromTable(tbl);
    if (cols.some((c) => c.value === field)) {
      return tbl.name || 'data';
    }
  }
  return undefined;
}

/** All columns across tables (label includes table when multiple tables exist). */
export function getAllColumnsForDataSource(
  dataSources: DataSourceWithSchema[],
  dataSourceId?: string,
): Array<SchemaColumnOption & { tableName?: string }> {
  if (!dataSourceId) return [];
  const ds = dataSources.find((d) => String(d.id) === String(dataSourceId));
  const tables = ds?.schema?.tables || [];
  const multi = tables.length > 1;
  const out: Array<SchemaColumnOption & { tableName?: string }> = [];
  for (const tbl of tables) {
    const tname = tbl.name || 'data';
    for (const col of columnsFromTable(tbl)) {
      out.push({
        ...col,
        label: multi ? `${tname}.${col.label}` : col.label,
        tableName: tname,
      });
    }
  }
  return out;
}

/** Fill missing tableName on saved filters from schema (aligns runtime with properties config). */
export function enrichFiltersWithTableNames(
  filters: DashboardFilter[],
  dataSources: DataSourceWithSchema[],
): DashboardFilter[] {
  return filters.map((f) => {
    if (f.tableName || !f.field || !f.dataSourceId) return f;
    const tableName = resolveTableForField(dataSources, f.dataSourceId, f.field);
    return tableName ? { ...f, tableName } : f;
  });
}

/** Map dataSourceId → tableName → columns (for filter manage modal). */
export function buildColumnOptionsBySource(
  dataSources: DataSourceWithSchema[],
): Record<string, Record<string, SchemaColumnOption[]>> {
  const out: Record<string, Record<string, SchemaColumnOption[]>> = {};
  for (const ds of dataSources) {
    const dsId = String(ds.id);
    const tables = ds.schema?.tables || [];
    out[dsId] = {};
    for (const tbl of tables) {
      const name = tbl.name || 'data';
      out[dsId][name] = columnsFromTable(tbl);
    }
    if (!tables.length) out[dsId][''] = [];
  }
  return out;
}
