/**
 * Shared schema-field helpers: semantic role inference, friendly naming, and
 * default aggregation suggestions for a table column.
 *
 * Extracted from the dashboard builder's field panel
 * (dashboards/components/StudioSidebar/sections/DataSection.tsx) so the Data
 * Source detail page's schema browser can offer the same quality of
 * role-inference / friendly names instead of a bare column list.
 */

export type SemanticRole = 'dimension' | 'measure' | 'date' | 'id';

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

export type SchemaFieldBusinessMetadata = {
  measures?: Array<{ name?: string; expression?: string; description?: string }>;
  dimensions?: Array<{ name?: string; description?: string }>;
  column_descriptions?: Record<string, string>;
};

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

export function fieldKey(table: { id?: string } | null, column: { name?: string } | null): string {
  if (!table?.id || !column?.name) return '';
  return `${table.id}.${column.name}`;
}

export function getBusinessMetadata(schema: unknown): SchemaFieldBusinessMetadata {
  const raw = ((schema as { business_metadata?: SchemaFieldBusinessMetadata } | null)?.business_metadata ??
    {}) as SchemaFieldBusinessMetadata;
  return {
    measures: Array.isArray(raw.measures) ? raw.measures : [],
    dimensions: Array.isArray(raw.dimensions) ? raw.dimensions : [],
    column_descriptions:
      raw.column_descriptions && typeof raw.column_descriptions === 'object' ? raw.column_descriptions : {},
  };
}

/** Best-effort semantic role for a column, using business metadata when available. */
export function inferSemanticRole(column: SchemaFieldColumn, metadata: SchemaFieldBusinessMetadata): SemanticRole {
  const name = column.name.toLowerCase();
  const normalizedType = normalizeType(column.type);
  const isMeasure = metadata.measures?.some((m) => m.name === column.name || m.expression === column.name);
  const isDimension = metadata.dimensions?.some((d) => d.name === column.name);
  if (isMeasure) return 'measure';
  if (isDimension) return 'dimension';
  if (column.primary_key || /(^id$|_id$|id$|key$|uuid$)/.test(name)) return 'id';
  if (normalizedType === 'Date' || /(date|time|month|year|quarter|week|day)/.test(name)) return 'date';
  if (normalizedType === 'Number' || normalizedType === 'Decimal') return 'measure';
  return 'dimension';
}

/** Suggested default aggregation for a column given its inferred role. */
export function defaultAggregation(column: SchemaFieldColumn, role: SemanticRole): string {
  const name = column.name.toLowerCase();
  if (role === 'measure') {
    if (/(rate|ratio|percent|pct|margin|score|price|unit_price|avg|average)/.test(name)) return 'avg';
    if (/(min|max)/.test(name)) return name.includes('min') ? 'min' : 'max';
    return 'sum';
  }
  if (role === 'id') return 'count distinct';
  return 'count';
}

export function roleColor(role: SemanticRole): string {
  if (role === 'measure') return 'green';
  if (role === 'date') return 'blue';
  if (role === 'id') return 'purple';
  return 'cyan';
}

export function roleLabelKey(role: SemanticRole): 'data_role_dimension' | 'data_role_measure' | 'data_role_date' | 'data_role_id' {
  if (role === 'measure') return 'data_role_measure';
  if (role === 'date') return 'data_role_date';
  if (role === 'id') return 'data_role_id';
  return 'data_role_dimension';
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
