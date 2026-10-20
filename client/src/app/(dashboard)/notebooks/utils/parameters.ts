import type { NotebookCell } from '@/services/notebookService';
import type { NotebookParameterDef } from '@/services/notebookService';

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*\}\}/g;

export function substituteParameters(
  cells: NotebookCell[],
  values: Record<string, unknown>,
  defs: NotebookParameterDef[],
): NotebookCell[] {
  const types = new Map(defs.map((d) => [d.name, d.type]));
  const sub = (text: string) =>
    text.replace(PLACEHOLDER, (_, name: string) => {
      if (!(name in values)) return `{{${name}}}`;
      const v = values[name];
      if (types.get(name) === 'boolean') return v ? 'true' : 'false';
      return String(v ?? '');
    });
  return cells.map((c) =>
    c.type === 'sql' || c.type === 'python' || c.type === 'markdown'
      ? { ...c, source: sub(c.source) }
      : c,
  );
}

export function defaultParamValues(defs: NotebookParameterDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    if (d.default !== undefined && d.default !== null) out[d.name] = d.default;
  }
  return out;
}
