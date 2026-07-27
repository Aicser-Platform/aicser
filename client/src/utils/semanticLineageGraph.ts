/** SemanticLineage payload → positioned nodes/edges for @xyflow/react. */

import dagre from 'dagre';
import type { SemanticLineage } from '@/types/semanticWorkbench';

export type FlowNode = {
  id: string;
  type: 'source' | 'table' | 'metric';
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind: 'source_table' | 'relationship' | 'metric';
};

const NODE_W = 200;
const NODE_H = 56;

export function lineageToFlow(
  lineage: SemanticLineage,
  options: { includeMetrics?: boolean } = {}
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const includeMetrics = options.includeMetrics ?? true;

  const sourceId = `source:${lineage.source.id}`;
  nodes.push({ id: sourceId, type: 'source', position: { x: 0, y: 0 }, data: { ...lineage.source } });

  for (const t of lineage.tables) {
    const id = `table:${t.name}`;
    nodes.push({ id, type: 'table', position: { x: 0, y: 0 }, data: { ...t } });
    edges.push({ id: `e:${sourceId}->${id}`, source: sourceId, target: id, kind: 'source_table' });
  }
  for (const j of lineage.joins) {
    edges.push({
      id: `e:join:${j.from_table}->${j.to_table}`,
      source: `table:${j.from_table}`,
      target: `table:${j.to_table}`,
      label: `${j.from_table}.${j.from_column} = ${j.to_table}.${j.to_column}`,
      kind: 'relationship',
    });
  }
  if (includeMetrics) {
    for (const m of lineage.metrics) {
      const id = `metric:${m.name}`;
      nodes.push({ id, type: 'metric', position: { x: 0, y: 0 }, data: { ...m } });
      edges.push({ id: `e:table:${m.table}->${id}`, source: `table:${m.table}`, target: id, kind: 'metric' });
    }
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  for (const n of nodes) {
    const pos = g.node(n.id);
    n.position = { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 };
  }

  return { nodes, edges };
}
