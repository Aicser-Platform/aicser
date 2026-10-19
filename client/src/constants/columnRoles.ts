// What a column is for, one vocabulary everywhere: Prepare's "Meaning", the connection Schema tab,
// the semantic model and Ask. Stored as schema.business_metadata.column_roles on a connection.
//
// A role is separate from the storage type: a Category can be text or a numeric code, an
// Identifier can be text or a number. Changing a role never converts the data.

export const COLUMN_ROLES = ['amount', 'count', 'category', 'date', 'id', 'text'] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

export type ColumnMetadata = {
  column_roles?: Record<string, string>;
  column_descriptions?: Record<string, string>;
  personal_columns?: string[];
};

const KEY_NAME = /(^id$|_id$|^id_|uuid|_key$|^key$)/i;
const DATE_NAME = /(date|_at$|^at_|time|timestamp|month|year|quarter|week|day$)/i;

/** A starting role from the column's name and storage type, until someone sets one. */
export function guessRole(name: string, type?: string | null): ColumnRole {
  const t = String(type ?? '').toLowerCase();
  if (KEY_NAME.test(name)) return 'id';
  if (/date|time/.test(t) || (/(^|_)(date|day|month|year)($|_)/i.test(name) && !/int|float|double|decimal|numeric/.test(t))) return 'date';
  if (/int|float|double|decimal|numeric|real|number|money/.test(t)) return DATE_NAME.test(name) && /int/.test(t) ? 'category' : 'amount';
  return 'category';
}

/** A column's entry keyed "schema.table.column", "table.column" or "column" (as the server reads it). */
export function columnEntry<T>(mapping: Record<string, T> | undefined, table: string | null | undefined, column: string): T | undefined {
  if (!mapping || !column) return undefined;
  const col = column.toLowerCase();
  const tbl = String(table ?? '').split('.').pop()!.toLowerCase();
  const entries = Object.entries(mapping).map(([k, v]) => [k.toLowerCase(), v] as const);
  if (tbl) {
    const hit = entries.find(([k]) => k === `${tbl}.${col}` || k.endsWith(`.${tbl}.${col}`));
    if (hit) return hit[1];
  }
  return entries.find(([k]) => k === col)?.[1];
}

/** The role people set for a column, or the guess (with `set: false`). */
export function roleFor(
  metadata: ColumnMetadata | undefined,
  table: string | null | undefined,
  column: string,
  type?: string | null,
): { role: ColumnRole; set: boolean } {
  const stored = columnEntry(metadata?.column_roles, table, column);
  if (stored && (COLUMN_ROLES as readonly string[]).includes(stored)) return { role: stored as ColumnRole, set: true };
  return { role: guessRole(column, type), set: false };
}

export const ROLE_COLOR: Record<ColumnRole, string> = {
  amount: 'green',
  count: 'green',
  category: 'cyan',
  date: 'blue',
  id: 'purple',
  text: 'default',
};
