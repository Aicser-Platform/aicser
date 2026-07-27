/** Client-side mirror of the server's metric filter grammar: column op literal. */

export type FilterOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE';

export type FilterRow = { field: string; op: FilterOp; value: string };

const NUMERIC = /^-?\d+(\.\d+)?$/;
const PARSE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(=|!=|>=|<=|>|<|LIKE)\s*(.+?)\s*$/;

export function filterRowToString(row: FilterRow): string {
  const literal = NUMERIC.test(row.value)
    ? row.value
    : `'${row.value.replace(/'/g, "''")}'`;
  return `${row.field} ${row.op} ${literal}`;
}

export function stringToFilterRow(s: string): FilterRow | null {
  const m = PARSE.exec(s);
  if (!m) return null;
  const [, field, op, rawValue] = m;
  let value = rawValue;
  if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1).replace(/''/g, "'");
    if (value.includes("'")) return null; // stray quotes = outside grammar
  } else if (!NUMERIC.test(value)) {
    return null;
  }
  return { field, op: op as FilterOp, value };
}
