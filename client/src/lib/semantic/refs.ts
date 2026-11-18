export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const quote = (s: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);

/** A SQL reference to a table's column, as the model's expressions write it (a file's one table is "data"). */
export const columnRef = (table: string, column: string) =>
  table === 'data' ? quote(column) : `${quote(table)}.${quote(column)}`;

/** Whether an expression mentions a column (by its bare or quoted name). */
export function usesColumn(expression: string, column: string): boolean {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])"?${escaped}"?($|[^A-Za-z0-9_])`, 'i').test(expression);
}
