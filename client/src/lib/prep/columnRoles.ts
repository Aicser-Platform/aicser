// Ported from ../aicser/client/src/constants/columnRoles.ts @ 749d38d (guessRole only; see PORTING.md).
// What a column is for: one vocabulary in Prepare's "Meaning", the semantic model and Ask. A role is separate from
// the storage type; changing a role never converts the data.
import type { ColumnRole } from '@/api/prep';

const KEY_NAME = /(^id$|_id$|^id_|uuid|_key$|^key$)/i;
const DATE_NAME = /(date|_at$|^at_|time|timestamp|month|year|quarter|week|day$)/i;

/** A starting role from the column's name and storage type, until someone sets one. */
export function guessRole(name: string, type?: string | null): ColumnRole {
  const t = String(type ?? '').toLowerCase();
  if (KEY_NAME.test(name)) return 'id';
  if (
    /date|time/.test(t) ||
    (/(^|_)(date|day|month|year)($|_)/i.test(name) && !/int|float|double|decimal|numeric/.test(t))
  )
    return 'date';
  if (/int|float|double|decimal|numeric|real|number|money/.test(t))
    return DATE_NAME.test(name) && /int/.test(t) ? 'category' : 'amount';
  return 'category';
}
