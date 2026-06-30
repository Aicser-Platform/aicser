'use client';

import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { Button, Input, Segmented } from 'antd';
import { ApartmentOutlined, PlusOutlined, SearchOutlined, TableOutlined } from '@ant-design/icons';
import { TableNode, type TableNodeData } from './TableNode';
import { RelationshipEdge, type RelationshipEdgeData } from './RelationshipEdge';
import type { DataModelRelationship } from '@/api/dataModel';
import './ERDCanvas.css';

// Must be defined at module level — not inside render — to avoid React Flow re-registration
const NODE_TYPES = { tableNode: TableNode };
const EDGE_TYPES = { relationshipEdge: RelationshipEdge };

const NODE_WIDTH = 310;
const NODE_HEIGHT = 310;

function columnFromHandle(nodeId: string, handleId: string | null | undefined): string {
  if (!handleId) return 'id';
  const withoutTargetSuffix = handleId.endsWith('__target')
    ? handleId.slice(0, -'__target'.length)
    : handleId;
  const prefix = `${nodeId}__`;
  if (withoutTargetSuffix.startsWith(prefix)) {
    return withoutTargetSuffix.slice(prefix.length) || 'id';
  }
  const [, ...parts] = withoutTargetSuffix.split('__');
  return parts.join('__') || 'id';
}

function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } };
  });
}

function layoutKey(id: string): string {
  return `erd_layout_${id}`;
}

export interface ERDCanvasProps {
  dataSourceId: string;
  tables: {
    id?: string;
    name: string;
    label?: string;
    schema?: string;
    sourceId: string;
    columns: { name: string; type: string }[];
  }[];
  relationships: DataModelRelationship[];
  onRelationshipSelect: (rel: DataModelRelationship | null) => void;
  onConnectionCreate: (connection: {
    fromTable: string;
    fromColumn: string;
    fromSourceId: string;
    toTable: string;
    toColumn: string;
    toSourceId: string;
  }) => void;
  selectedRelationshipId: string | null;
}

export function ERDCanvas({
  dataSourceId,
  tables,
  relationships,
  onRelationshipSelect,
  onConnectionCreate,
  selectedRelationshipId,
}: ERDCanvasProps) {
  const [search, setSearch] = useState('');

  const filteredTables = useMemo(
    () =>
      search
        ? tables.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
        : tables,
    [tables, search],
  );

  const tableIdentity = useMemo(() => {
    const byName = new Map<string, string>();
    const ids = new Set<string>();
    filteredTables.forEach((table) => {
      const id = table.id || table.name;
      ids.add(id);
      byName.set(table.name, id);
      byName.set(id, id);
      if (table.schema) {
        byName.set(`${table.schema}.${table.name}`, id);
      }
    });
    return { byName, ids };
  }, [filteredTables]);

  const sourceIdByNodeId = useMemo(() => {
    const map = new Map<string, string>();
    filteredTables.forEach((table) => {
      const id = table.id || table.name;
      map.set(id, table.sourceId);
    });
    return map;
  }, [filteredTables]);

  const resolveTableId = useCallback(
    (tableName: string) => {
      const exact = tableIdentity.byName.get(tableName);
      if (exact) return exact;
      const suffix = `.${tableName}`;
      const match = Array.from(tableIdentity.ids).find((id) => id.endsWith(suffix));
      return match || tableName;
    },
    [tableIdentity],
  );

  const initialNodes: Node[] = useMemo(
    () =>
      filteredTables.map((table) => ({
        id: table.id || table.name,
        type: 'tableNode',
        position: { x: 0, y: 0 },
        data: {
          tableId: table.id || table.name,
          tableName: table.label || table.name,
          columns: table.columns,
        } satisfies TableNodeData,
      })),
    [filteredTables],
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      relationships.map((rel) => {
        const source = resolveTableId(rel.from_table);
        const target = resolveTableId(rel.to_table);
        return {
          id: rel.id,
          source,
          target,
          sourceHandle: `${source}__${rel.from_column}`,
          targetHandle: `${target}__${rel.to_column}__target`,
          type: 'relationshipEdge',
          selected: rel.id === selectedRelationshipId,
          data: {
            cardinality: rel.cardinality,
            relationshipId: rel.id,
            onSelect: (id: string) => {
              const found = relationships.find((r) => r.id === id) ?? null;
              onRelationshipSelect(found);
            },
          } satisfies RelationshipEdgeData,
        };
      }),
    [relationships, selectedRelationshipId, onRelationshipSelect, resolveTableId],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);

  // Apply layout on first load or when tables change; restore from localStorage
  useEffect(() => {
    const savedRaw =
      typeof window !== 'undefined' ? localStorage.getItem(layoutKey(dataSourceId)) : null;
    let positioned: Node[];
    if (savedRaw) {
      try {
        const savedPositions = JSON.parse(savedRaw) as Record<string, { x: number; y: number }>;
        positioned = initialNodes.map((n) =>
          savedPositions[n.id] ? { ...n, position: savedPositions[n.id] } : n,
        );
      } catch {
        positioned = autoLayout(initialNodes, initialEdges);
      }
    } else {
      positioned = autoLayout(initialNodes, initialEdges);
    }
    setNodes(positioned);
    setEdges(initialEdges);
    setTimeout(() => rfInstanceRef.current?.fitView({ padding: 0.15 }), 50);
  }, [dataSourceId, initialNodes, initialEdges, setNodes, setEdges]);

  const persistPositions = useCallback(
    (current: Node[]) => {
      const positions: Record<string, { x: number; y: number }> = {};
      current.forEach((n) => {
        positions[n.id] = n.position;
      });
      try {
        localStorage.setItem(layoutKey(dataSourceId), JSON.stringify(positions));
      } catch {
        // ignore storage quota errors
      }
    },
    [dataSourceId],
  );

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      // Persist positions after drag — use a tiny timeout so the state has settled
      setTimeout(() => {
        setNodes((current) => {
          persistPositions(current);
          return current;
        });
      }, 50);
    },
    [onNodesChange, setNodes, persistPositions],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !connection.sourceHandle) return;
      onConnectionCreate({
        fromTable: connection.source,
        fromColumn: columnFromHandle(connection.source, connection.sourceHandle),
        fromSourceId: sourceIdByNodeId.get(connection.source) ?? connection.source,
        toTable: connection.target,
        toColumn: columnFromHandle(connection.target, connection.targetHandle),
        toSourceId: sourceIdByNodeId.get(connection.target) ?? connection.target,
      });
    },
    [onConnectionCreate, sourceIdByNodeId],
  );

  const handleAutoLayout = useCallback(() => {
    const laid = autoLayout(nodes, edges);
    setNodes(laid);
    persistPositions(laid);
  }, [nodes, edges, setNodes, persistPositions]);

  return (
    <div className="erd-canvas-wrapper">
      <div className="erd-toolbar">
        <div className="erd-toolbar-left">
          <Segmented
            size="small"
            value="relationships"
            options={[{ value: 'relationships', label: 'Relationship View' }, { value: 'details', label: 'Details' }]}
          />
          <Button size="small" icon={<PlusOutlined />}>
            New Table
          </Button>
          <Button size="small" icon={<ApartmentOutlined />} onClick={handleAutoLayout}>
            Auto Layout
          </Button>
        </div>
        <Input
          size="small"
          prefix={<SearchOutlined />}
          placeholder="Search schema..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          className="erd-search"
        />
      </div>
      {filteredTables.length === 0 ? (
        <div className="erd-empty-state">
          <TableOutlined />
          <span>No matching tables</span>
        </div>
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onInit={(instance) => { rfInstanceRef.current = instance; }}
        fitView
        minZoom={0.3}
        maxZoom={1}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
