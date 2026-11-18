// Relationship diagram layout (written for desktop): first positions for the React Flow canvas, tables in columns by
// join distance from the most connected table, so most links run left to right; unjoined tables go in a last column.
import type { Relationship } from '@/api/semanticStudio';

export const NODE_WIDTH = 260;
export const HEADER_HEIGHT = 44;
export const ROW_HEIGHT = 26;
const GAP_X = 120;
const GAP_Y = 40;
const MARGIN = 24;

export interface DiagramTable {
  name: string;
  columns: { name: string; type: string }[];
}

export interface PlacedTable extends DiagramTable {
  x: number;
  y: number;
  height: number;
}

const CARDINALITY_LABEL: Record<string, string> = {
  one_to_one: '1:1',
  one_to_many: '1:N',
  many_to_one: 'N:1',
  many_to_many: 'N:N',
};

export const CARDINALITY_WORDS: Record<string, string> = {
  one_to_one: 'One to one',
  one_to_many: 'One to many',
  many_to_one: 'Many to one',
  many_to_many: 'Many to many',
};

export const cardinalityLabel = (c: string) => CARDINALITY_LABEL[c] ?? c;

/** Places tables: breadth-first columns from the table with the most links. */
export function layoutTables(tables: DiagramTable[], relationships: Relationship[]): PlacedTable[] {
  const names = new Set(tables.map((t) => t.name));
  const links = new Map<string, Set<string>>();
  for (const r of relationships) {
    if (!names.has(r.from_table) || !names.has(r.to_table) || r.from_table === r.to_table) continue;
    if (!links.has(r.from_table)) links.set(r.from_table, new Set());
    if (!links.has(r.to_table)) links.set(r.to_table, new Set());
    links.get(r.from_table)!.add(r.to_table);
    links.get(r.to_table)!.add(r.from_table);
  }
  const depth = new Map<string, number>();
  const linked = [...links.keys()].sort((a, b) => links.get(b)!.size - links.get(a)!.size || a.localeCompare(b));
  let offset = 0;
  // Each group of joined tables gets its own run of columns.
  for (const start of linked) {
    if (depth.has(start)) continue;
    depth.set(start, offset);
    const queue = [start];
    let deepest = offset;
    while (queue.length) {
      const name = queue.shift()!;
      for (const next of [...links.get(name)!].sort()) {
        if (depth.has(next)) continue;
        const d = depth.get(name)! + 1;
        depth.set(next, d);
        deepest = Math.max(deepest, d);
        queue.push(next);
      }
    }
    offset = deepest + 1;
  }
  for (const t of tables) if (!depth.has(t.name)) depth.set(t.name, offset);

  const nextY = new Map<number, number>();
  return tables
    .slice()
    .sort((a, b) => depth.get(a.name)! - depth.get(b.name)! || a.name.localeCompare(b.name))
    .map((t) => {
      const col = depth.get(t.name)!;
      const height = HEADER_HEIGHT + Math.max(1, t.columns.length) * ROW_HEIGHT;
      const y = nextY.get(col) ?? MARGIN;
      nextY.set(col, y + height + GAP_Y);
      return { ...t, x: MARGIN + col * (NODE_WIDTH + GAP_X), y, height };
    });
}

/** Which side of each table a link leaves and enters by: the sides facing each other (left when stacked). */
export function linkSides(fromX: number, toX: number): { source: 'l' | 'r'; target: 'l' | 'r' } {
  if (Math.abs(fromX - toX) < NODE_WIDTH / 2) return { source: 'l', target: 'l' };
  return fromX < toX ? { source: 'r', target: 'l' } : { source: 'l', target: 'r' };
}

/** A column's connection point on one side of its table node. */
export const handleId = (side: 'l' | 'r', column: string) => `${side}:${column}`;

/** The column a handle id points at (null for the table's own handle). */
export const handleColumn = (handle: string | null | undefined) =>
  handle && handle.length > 2 ? handle.slice(2) : null;
