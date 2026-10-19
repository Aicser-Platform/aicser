import type { SchemaInfo } from '@/stores/useDataSourceStore';

export function columnOptionsFromSchema(schema: SchemaInfo | null | undefined) {
  const out: { label: string; value: string; type?: string }[] = [];
  if (!schema?.tables?.length) return out;
  for (const table of schema.tables) {
    const tname = table.name || 'data';
    for (const col of table.columns || []) {
      const cname = typeof col === 'string' ? col : col.name;
      if (!cname) continue;
      const ctype = typeof col === 'object' && col && 'type' in col ? String(col.type) : undefined;
      out.push({
        label: schema.tables.length > 1 ? `${tname}.${cname}` : cname,
        value: cname,
        type: ctype,
      });
    }
  }
  return out;
}
