// Relationship diagram on React Flow (@xyflow/react, as web's model view): drag tables, pan, zoom, minimap; drag
// from one column to a column of another table to add a relationship; a link's cardinality label opens its menu.
import '@xyflow/react/dist/style.css';
import '@/styles/flow.css';
import {
  Background,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  getBezierPath,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { KeyRound } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { CARDINALITIES, JOIN_TYPES, type Relationship } from '@/api/semanticStudio';
import type { SchemaTable } from '@/lib/desktop/dataSources';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/aicser-ui/dropdown-menu';
import { readPreference, writePreference } from '@/lib/desktop/storage';
import {
  CARDINALITY_WORDS,
  HEADER_HEIGHT,
  NODE_WIDTH,
  ROW_HEIGHT,
  cardinalityLabel,
  handleColumn,
  handleId,
  layoutTables,
  linkSides,
} from '@/lib/semantic/diagram';
import { useThemePreference } from '@/lib/desktop/theme';
import { cn } from '@/lib/ui/utils';

type TableData = { table: SchemaTable; joined: Set<string> };
type TableNode = Node<TableData, 'table'>;
type LinkData = {
  relationship: Relationship;
  onChange: (r: Relationship, patch: { cardinality?: string; join_type?: string }) => void;
  onDelete: (r: Relationship) => void;
};
type LinkEdge = Edge<LinkData, 'link'>;

function TableNodeView({ data, selected }: NodeProps<TableNode>) {
  const { table, joined } = data;
  return (
    <div
      className={cn(
        'overflow-visible rounded-lg border bg-card text-card-foreground shadow-sm',
        selected && 'ring-2 ring-primary'
      )}
      style={{ width: NODE_WIDTH }}
      role="group"
      aria-label={`Table ${table.name}`}
    >
      <div
        className="flex cursor-grab flex-col justify-center border-b px-3 active:cursor-grabbing"
        style={{ height: HEADER_HEIGHT }}
      >
        <p className="truncate text-sm font-semibold">{table.name}</p>
        <p className="text-[10px] text-muted-foreground">{table.columns.length} columns</p>
      </div>
      {table.columns.map((c) => {
        const on = joined.has(c.name);
        return (
          <div key={c.name} className="relative flex items-center gap-1.5 px-3 text-xs" style={{ height: ROW_HEIGHT }}>
            {/* Loose connection mode: every handle can start or end a link, on either side. */}
            <Handle
              type="source"
              id={handleId('l', c.name)}
              position={Position.Left}
              data-joined={on}
              aria-label={`${table.name}.${c.name} left`}
            />
            <Handle
              type="source"
              id={handleId('r', c.name)}
              position={Position.Right}
              data-joined={on}
              aria-label={`${table.name}.${c.name} right`}
            />
            {on ? <KeyRound className="size-3 shrink-0 text-primary" aria-label="joined" /> : <span className="w-3" />}
            <span className="flex-1 truncate">{c.name}</span>
            <span className="max-w-24 truncate text-[10px] text-muted-foreground uppercase" title={c.type}>
              {c.type}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LinkEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<LinkEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  if (!data) return null;
  const r = data.relationship;
  return (
    <>
      <BaseEdge id={id} path={path} className={cn(!r.is_active && 'opacity-40')} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${r.from_table}.${r.from_column} to ${r.to_table}.${r.to_column}: ${CARDINALITY_WORDS[r.cardinality] ?? r.cardinality}`}
                className={cn(
                  'rounded border bg-card px-1.5 py-0.5 font-mono text-[10px] shadow-sm hover:border-primary',
                  selected && 'border-primary'
                )}
              >
                {cardinalityLabel(r.cardinality)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-56">
              <DropdownMenuLabel className="font-mono text-xs font-normal text-muted-foreground">
                {r.from_table}.{r.from_column} → {r.to_table}.{r.to_column}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">Cardinality</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={r.cardinality} onValueChange={(v) => data.onChange(r, { cardinality: v })}>
                {CARDINALITIES.map((c) => (
                  <DropdownMenuRadioItem key={c} value={c}>
                    {cardinalityLabel(c)} · {CARDINALITY_WORDS[c]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">Join</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={r.join_type.toUpperCase()}
                onValueChange={(v) => data.onChange(r, { join_type: v })}
              >
                {JOIN_TYPES.map((j) => (
                  <DropdownMenuRadioItem key={j} value={j}>
                    {j}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => data.onDelete(r)}>
                Delete relationship
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const NODE_TYPES = { table: TableNodeView };
const EDGE_TYPES = { link: LinkEdgeView };

type Positions = Record<string, { x: number; y: number }>;
const positionsKey = (dataSourceId: string) => `aicser.semantic.positions.${dataSourceId}`;

function buildEdges(
  nodes: TableNode[],
  relationships: Relationship[],
  handlers: Omit<LinkData, 'relationship'>
): LinkEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: LinkEdge[] = [];
  for (const r of relationships) {
    const from = byId.get(r.from_table);
    const to = byId.get(r.to_table);
    // Links to another connection's tables aren't drawn here (they're in the join list).
    if (!from || !to || r.to_data_source_id) continue;
    const sides = linkSides(from.position.x, to.position.x);
    const has = (n: TableNode, col: string) => n.data.table.columns.some((c) => c.name === col);
    if (!has(from, r.from_column) || !has(to, r.to_column)) continue;
    edges.push({
      id: r.id,
      type: 'link',
      source: from.id,
      target: to.id,
      sourceHandle: handleId(sides.source, r.from_column),
      targetHandle: handleId(sides.target, r.to_column),
      data: { relationship: r, ...handlers },
    });
  }
  return edges;
}

/**
 * The diagram. Table positions are remembered per connection on this computer (a UI preference, lib/storage).
 * `onConnect` gets the two columns a person linked; the caller asks for the cardinality and saves.
 */
export function RelationshipDiagram({
  dataSourceId,
  tables,
  relationships,
  onConnect,
  onChange,
  onDelete,
}: {
  dataSourceId: string;
  tables: SchemaTable[];
  relationships: Relationship[];
  onConnect: (link: { from_table: string; from_column: string; to_table: string; to_column: string }) => void;
  onChange: LinkData['onChange'];
  onDelete: LinkData['onDelete'];
}) {
  const theme = useThemePreference();
  const initialNodes = useMemo<TableNode[]>(() => {
    const saved = readPreference<Positions>(positionsKey(dataSourceId), {});
    const joined = new Map<string, Set<string>>();
    const mark = (t: string, c: string) => {
      if (!joined.has(t)) joined.set(t, new Set());
      joined.get(t)!.add(c);
    };
    for (const r of relationships) {
      mark(r.from_table, r.from_column);
      mark(r.to_table, r.to_column);
    }
    return layoutTables(tables, relationships).map((t) => ({
      id: t.name,
      type: 'table',
      position: saved[t.name] ?? { x: t.x, y: t.y },
      data: { table: t, joined: joined.get(t.name) ?? new Set() },
    }));
  }, [dataSourceId, tables, relationships]);

  const [nodes, setNodes, onNodesChange] = useNodesState<TableNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LinkEdge>([]);
  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  // Links follow the tables: each side is picked from where the two tables are now.
  useEffect(
    () => setEdges(buildEdges(nodes, relationships, { onChange, onDelete })),
    [nodes, relationships, onChange, onDelete, setEdges]
  );

  const remember = useCallback(
    (moved: TableNode[]) => {
      const saved = readPreference<Positions>(positionsKey(dataSourceId), {});
      for (const n of moved) saved[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
      writePreference(positionsKey(dataSourceId), saved);
    },
    [dataSourceId]
  );

  const connect = useCallback(
    (c: Connection) => {
      const fromColumn = handleColumn(c.sourceHandle);
      const toColumn = handleColumn(c.targetHandle);
      if (!fromColumn || !toColumn || c.source === c.target) return;
      onConnect({ from_table: c.source, from_column: fromColumn, to_table: c.target, to_column: toColumn });
    },
    [onConnect]
  );

  return (
    <ReactFlow<TableNode, LinkEdge>
      className="aicser-flow"
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={(_event, _node, moved) => remember(moved)}
      onConnect={connect}
      connectionMode={ConnectionMode.Loose}
      colorMode={theme}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      maxZoom={2}
      deleteKeyCode={null}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} size={1} />
      <Controls position="bottom-left" />
      <MiniMap position="bottom-right" pannable zoomable ariaLabel="Diagram overview" />
    </ReactFlow>
  );
}
