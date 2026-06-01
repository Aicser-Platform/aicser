import type { DataModelRelationship } from '@/api/dataModel';

export type GraphNode = {
  id: string;
  label: string;
  role: 'fact' | 'dimension';
  x: number;
  y: number;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  joinType: string;
};

export type GraphLayout = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  modelHint: 'star' | 'snowflake' | 'flat';
  width: number;
  height: number;
};

function tableDegree(relationships: DataModelRelationship[]): Map<string, number> {
  const degree = new Map<string, number>();
  const touch = (t: string) => degree.set(t, (degree.get(t) || 0) + 1);
  for (const r of relationships) {
    touch(r.from_table);
    touch(r.to_table);
  }
  return degree;
}

function pickFactTable(relationships: DataModelRelationship[]): string | null {
  if (!relationships.length) return null;
  const outCount = new Map<string, number>();
  for (const r of relationships) {
    outCount.set(r.from_table, (outCount.get(r.from_table) || 0) + 1);
  }
  let best = relationships[0].from_table;
  let bestScore = -1;
  for (const [table, score] of outCount) {
    if (score > bestScore) {
      best = table;
      bestScore = score;
    }
  }
  return best;
}

/** Lightweight star/snowflake layout for relationship visualization (no graph library). */
export function buildRelationshipGraphLayout(relationships: DataModelRelationship[]): GraphLayout {
  const tables = new Set<string>();
  relationships.forEach((r) => {
    tables.add(r.from_table);
    tables.add(r.to_table);
  });

  const tableList = [...tables];
  const fact = pickFactTable(relationships) || tableList[0] || 'data';
  const dimensions = tableList.filter((t) => t !== fact);
  const degree = tableDegree(relationships);
  const maxDegree = Math.max(...[...degree.values()], 1);
  const hasChain = relationships.some(
    (r) => dimensions.includes(r.from_table) && dimensions.includes(r.to_table),
  );
  const modelHint: GraphLayout['modelHint'] =
    tableList.length <= 1 ? 'flat' : hasChain ? 'snowflake' : maxDegree >= 2 ? 'star' : 'flat';

  const width = 520;
  const height = Math.max(280, 120 + dimensions.length * 36);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.34;

  const nodes: GraphNode[] = [
    {
      id: fact,
      label: fact,
      role: 'fact',
      x: cx,
      y: cy,
    },
  ];

  dimensions.forEach((table, i) => {
    const angle = (2 * Math.PI * i) / Math.max(dimensions.length, 1) - Math.PI / 2;
    nodes.push({
      id: table,
      label: table,
      role: 'dimension',
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });

  if (tableList.length === 1 && !relationships.length) {
    nodes[0] = { id: tableList[0], label: tableList[0], role: 'fact', x: cx, y: cy / 2 + 40 };
  }

  const edges: GraphEdge[] = relationships.map((r, i) => ({
    id: `e-${i}`,
    from: r.from_table,
    to: r.to_table,
    joinType: r.join_type || 'LEFT',
    label: `${r.from_column} → ${r.to_column}`,
  }));

  return { nodes, edges, modelHint, width, height };
}
