import type { ColumnMetadata } from '@/constants/columnRoles';
/**
 * Shared schema-field helpers: semantic role inference, friendly naming, and
 * default aggregation suggestions for a table column.
 *
 * Used by the Data Source detail page's schema browser for role inference and
 * friendly names instead of a bare column list.
 */

export type SchemaFieldColumn = {
  name: string;
  type: string;
  nullable?: boolean;
  primary_key?: boolean;
  foreign_key?: string;
};

export type SchemaFieldTable = {
  id: string;
  name: string;
  schema?: string;
  rowCount?: number | null;
  columns: SchemaFieldColumn[];
};

/** Column facts on a connection; metrics and dimensions themselves live in the semantic model. */
export type SchemaFieldBusinessMetadata = ColumnMetadata;

/** Coarse, human-facing type bucket for a raw SQL/backend column type string. */
export function normalizeType(type: string): string {
  const upper = String(type || '').toUpperCase();
  if (upper.includes('INT')) return 'Number';
  if (upper.includes('DECIMAL') || upper.includes('NUMERIC') || upper.includes('DOUBLE') || upper.includes('FLOAT')) return 'Decimal';
  if (upper.includes('DATE') || upper.includes('TIME')) return 'Date';
  if (upper.includes('BOOL')) return 'Boolean';
  return 'Text';
}

/** `order_total` -> `Order Total`. */
export function friendlyName(name: string): string {
  return String(name || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * How a column reads to people: its business label when the data source defines one, otherwise
 * its name in words ("order_total" → "Order Total"). The raw name stays the value everywhere.
 */
export function fieldDisplayName(column: unknown): string {
  if (typeof column === 'string') return friendlyName(column);
  const c = (column || {}) as { name?: unknown; label?: unknown; display_name?: unknown; displayName?: unknown };
  const label = [c.label, c.display_name, c.displayName].find((v) => typeof v === 'string' && v.trim());
  return label ? String(label).trim() : friendlyName(String(c.name ?? ''));
}

export function fieldKey(table: { id?: string } | null, column: { name?: string } | null): string {
  if (!table?.id || !column?.name) return '';
  return `${table.id}.${column.name}`;
}

export function getBusinessMetadata(schema: unknown): SchemaFieldBusinessMetadata {
  const raw = ((schema as { business_metadata?: SchemaFieldBusinessMetadata } | null)?.business_metadata ??
    {}) as SchemaFieldBusinessMetadata;
  const obj = <T,>(v: T | undefined) => (v && typeof v === 'object' ? v : ({} as T));
  return {
    column_descriptions: obj(raw.column_descriptions),
    column_roles: obj(raw.column_roles),
    personal_columns: Array.isArray(raw.personal_columns) ? raw.personal_columns : [],
  };
}

export function tableId(table: { name?: string; schema?: string }): string {
  const name = String(table.name || '').trim();
  const schema = String(table.schema || '').trim();
  if (!schema || schema === 'public' || schema === 'file') return name;
  return `${schema}.${name}`;
}

/** Normalize a raw schema payload's `tables` array into `SchemaFieldTable[]`. */
export function normalizeSchemaTables(schema: unknown): SchemaFieldTable[] {
  const rawTables = ((schema as { tables?: unknown[] } | null)?.tables ?? []) as Array<{
    name?: string;
    schema?: string;
    rowCount?: number | null;
    row_count?: number | null;
    columns?: Array<SchemaFieldColumn | string>;
  }>;

  return rawTables
    .map((table): SchemaFieldTable | null => {
      const name = String(table.name || '').trim();
      if (!name) return null;
      const id = tableId(table);
      const normalizedTable: SchemaFieldTable = {
        id,
        name,
        rowCount: table.rowCount ?? table.row_count ?? null,
        columns: (table.columns ?? [])
          .map((column): SchemaFieldColumn | null => {
            if (typeof column === 'string') {
              return { name: column, type: 'string', nullable: true };
            }
            const columnName = String(column?.name || '').trim();
            if (!columnName) return null;
            const normalizedColumn: SchemaFieldColumn = {
              name: columnName,
              type: String(column?.type || 'string'),
              nullable: column?.nullable ?? true,
            };
            if (column?.primary_key !== undefined) normalizedColumn.primary_key = column.primary_key;
            if (column?.foreign_key !== undefined) normalizedColumn.foreign_key = column.foreign_key;
            return normalizedColumn;
          })
          .filter((column): column is SchemaFieldColumn => Boolean(column)),
      };
      if (table.schema !== undefined) normalizedTable.schema = table.schema;
      return normalizedTable;
    })
    .filter((table): table is SchemaFieldTable => Boolean(table));
}


/** Quote a SQL identifier only when it needs it (spaces, hyphens, leading digit, etc). */
export function quoteIdentifier(id: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id) ? id : `"${String(id).replace(/"/g, '""')}"`;
}

/** A table reference safe to put in `SELECT … FROM <ref>` for this source (files expose "data"). */
export function buildTableRef(table: { name: string; schema?: string | null }, dataSourceType?: string | null): string {
  const isFile = dataSourceType === 'file';
  const tableName = isFile ? 'data' : table.name;
  if (isFile || !table.schema || table.schema === 'public' || table.schema === 'file') {
    return quoteIdentifier(tableName);
  }
  return `${quoteIdentifier(table.schema)}.${quoteIdentifier(tableName)}`;
}
