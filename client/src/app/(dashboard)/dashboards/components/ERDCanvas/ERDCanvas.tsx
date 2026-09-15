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
import { useTranslations } from 'next-intl';
import { Button, Input, Segmented } from 'antd';
import { ApartmentOutlined, RadarChartOutlined, SearchOutlined, TableOutlined } from '@ant-design/icons';
import { TableNode, type TableNodeData } from './TableNode';
import { RelationshipEdge, type RelationshipEdgeData } from './RelationshipEdge';
import type { DataModelRelationship } from '@/api/dataModel';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import './ERDCanvas.css';

// Must be defined at module level — not inside render — to avoid React Flow re-registration
const NODE_TYPES = { tableNode: TableNode };
const EDGE_TYPES = { relationshipEdge: RelationshipEdge };

const NODE_WIDTH = 310;
// Mirrors the fixed chrome in ERDCanvas.css: 40px header + ~20px column-count
// subtitle + 10px body padding, plus 30px per row up to the body's own
// max-height:280px scroll cap. Real ERD tools (dbdiagram.io, Power BI's
// model view) size layout nodes off actual row count instead of a flat
// guess — a table with 3 columns and one with 30 shouldn't claim the same
// vertical slot, or dagre either overlaps the tall one or wastes space
// around the short one.
const HEADER_HEIGHT = 40;
const SUBTITLE_HEIGHT = 20;
const ROW_HEIGHT = 30;
const BODY_PADDING = 10;
const BODY_MAX_HEIGHT = 280;

function estimateNodeHeight(columnCount: number): number {
  const bodyHeight = Math.min(Math.max(columnCount, 1) * ROW_HEIGHT, BODY_MAX_HEIGHT) + BODY_PADDING;
  return HEADER_HEIGHT + SUBTITLE_HEIGHT + bodyHeight;
}

type PendingColumnConnection = {
  nodeId: string;
  tableName: string;
  sourceId: string;
  columnName: string;
};

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

// Grid fallback for a schema with no relationships at all (nothing detected,
// nothing manually joined yet) — a single dagre rank would stack every table
// in one tall column, which is what produced the "just a list, no modeling"
// complaint. A grid at least reads as a deliberate overview instead of a
// side-effect of an empty edge list.
function gridLayout(nodes: Node[]): Node[] {
  const perRow = Math.max(1, Math.round(Math.sqrt(nodes.length)));
  const colGap = 70;
  const rowGap = 70;
  let x = 0;
  let y = 0;
  let col = 0;
  let rowMaxHeight = 0;
  return nodes.map((n) => {
    const columnCount = (n.data as unknown as TableNodeData)?.columns?.length ?? 0;
    const height = estimateNodeHeight(columnCount);
    const position = { x, y };
    rowMaxHeight = Math.max(rowMaxHeight, height);
    col += 1;
    x += NODE_WIDTH + colGap;
    if (col >= perRow) {
      col = 0;
      x = 0;
      y += rowMaxHeight + rowGap;
      rowMaxHeight = 0;
    }
    return { ...n, position };
  });
}

function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (edges.length === 0) return gridLayout(nodes);

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  // tight-tree (vs. dagre's default network-simplex) favors pulling
  // connected nodes toward their neighbors' rank instead of spreading them
  // to minimize total edge length globally — for a star schema that keeps
  // dimension tables hugging the fact table they reference instead of
  // drifting apart when the graph also has an unrelated snowflake chain.
  g.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 110, ranker: 'tight-tree' });
  nodes.forEach((n) => {
    const columnCount = (n.data as unknown as TableNodeData)?.columns?.length ?? 0;
    g.setNode(n.id, { width: NODE_WIDTH, height: estimateNodeHeight(columnCount) });
  });
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    const columnCount = (n.data as unknown as TableNodeData)?.columns?.length ?? 0;
    const height = estimateNodeHeight(columnCount);
    return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - height / 2 } };
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
  onDetectRelationships?: () => void;
  isDetectingRelationships?: boolean;
}

export function ERDCanvas({
  dataSourceId,
  tables,
  relationships,
  onRelationshipSelect,
  onConnectionCreate,
  selectedRelationshipId,
  onDetectRelationships,
  isDetectingRelationships,
}: ERDCanvasProps) {
  const t = useTranslations('dashboards_page');
  const { isDarkMode } = useThemeMode();
  const [search, setSearch] = useState('');
  const [pendingColumn, setPendingColumn] = useState<PendingColumnConnection | null>(null);
  const normalizedSearch = search.trim().toLowerCase();

  const filteredTables = useMemo(
    () =>
      normalizedSearch
        ? tables.filter((t) => {
            const tableMatches = t.name.toLowerCase().includes(normalizedSearch);
            const labelMatches = String(t.label || '').toLowerCase().includes(normalizedSearch);
            const columnMatches = t.columns.some((col) =>
              col.name.toLowerCase().includes(normalizedSearch),
            );
            return tableMatches || labelMatches || columnMatches;
          })
        : tables,
    [tables, normalizedSearch],
  );

  const tableIdentity = useMemo(() => {
    const byName = new Map<string, string>();
    const bySourceAndName = new Map<string, string>();
    const ids = new Set<string>();
    filteredTables.forEach((table) => {
      const id = table.id || table.name;
      ids.add(id);
      byName.set(table.name, id);
      byName.set(id, id);
      bySourceAndName.set(`${table.sourceId}::${table.name}`, id);
      bySourceAndName.set(`${table.sourceId}::${id}`, id);
      if (table.schema) {
        byName.set(`${table.schema}.${table.name}`, id);
        bySourceAndName.set(`${table.sourceId}::${table.schema}.${table.name}`, id);
      }
    });
    return { byName, bySourceAndName, ids };
  }, [filteredTables]);

  const tableMetaByNodeId = useMemo(() => {
    const map = new Map<string, { sourceId: string; tableName: string }>();
    filteredTables.forEach((table) => {
      const id = table.id || table.name;
      map.set(id, { sourceId: table.sourceId, tableName: table.name });
    });
    return map;
  }, [filteredTables]);

  const resolveTableId = useCallback(
    (tableName: string, sourceId?: string | null) => {
      if (sourceId) {
        const sourceMatch = tableIdentity.bySourceAndName.get(`${sourceId}::${tableName}`);
        if (sourceMatch) return sourceMatch;
      }
      const exact = tableIdentity.byName.get(tableName);
      if (exact) return exact;
      const suffix = `.${tableName}`;
      const match = Array.from(tableIdentity.ids).find((id) => id.endsWith(suffix));
      return match || tableName;
    },
    [tableIdentity],
  );

  const handleColumnPick = useCallback(
    (column: PendingColumnConnection) => {
      setPendingColumn((current) => {
        if (!current) return column;

        const sameColumn =
          current.nodeId === column.nodeId && current.columnName === column.columnName;
        if (sameColumn) return null;

        onConnectionCreate({
          fromTable: current.tableName,
          fromColumn: current.columnName,
          fromSourceId: current.sourceId,
          toTable: column.tableName,
          toColumn: column.columnName,
          toSourceId: column.sourceId,
        });
        return null;
      });
    },
    [onConnectionCreate],
  );

  const initialNodes: Node[] = useMemo(
    () =>
      filteredTables.map((table) => {
        const id = table.id || table.name;
        const tableMatches =
          Boolean(normalizedSearch) &&
          (table.name.toLowerCase().includes(normalizedSearch) ||
            String(table.label || '').toLowerCase().includes(normalizedSearch));

        return {
          id,
          type: 'tableNode',
          position: { x: 0, y: 0 },
          data: {
            tableId: id,
            tableName: table.label || table.name,
            rawTableName: table.name,
            sourceId: table.sourceId,
            columnFilter: normalizedSearch && !tableMatches ? normalizedSearch : '',
            pendingColumnKey: null,
            onColumnPick: handleColumnPick,
            columns: table.columns,
          } satisfies TableNodeData,
        };
      }),
    [filteredTables, handleColumnPick, normalizedSearch],
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      relationships.map((rel) => {
        const source = resolveTableId(rel.from_table, rel.data_source_id);
        const target = resolveTableId(rel.to_table, rel.to_data_source_id ?? rel.data_source_id);
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

  useEffect(() => {
    setPendingColumn(null);
  }, [dataSourceId, normalizedSearch]);

  useEffect(() => {
    const pendingColumnKey = pendingColumn
      ? `${pendingColumn.nodeId}__${pendingColumn.columnName}`
      : null;
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          pendingColumnKey,
          onColumnPick: handleColumnPick,
        },
      })),
    );
  }, [handleColumnPick, pendingColumn, setNodes]);

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
      const sourceMeta = tableMetaByNodeId.get(connection.source);
      const targetMeta = tableMetaByNodeId.get(connection.target);
      onConnectionCreate({
        fromTable: sourceMeta?.tableName ?? connection.source,
        fromColumn: columnFromHandle(connection.source, connection.sourceHandle),
        fromSourceId: sourceMeta?.sourceId ?? connection.source,
        toTable: targetMeta?.tableName ?? connection.target,
        toColumn: columnFromHandle(connection.target, connection.targetHandle),
        toSourceId: targetMeta?.sourceId ?? connection.target,
      });
    },
    [onConnectionCreate, tableMetaByNodeId],
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
            options={[
              { value: 'relationships', label: t('erd_relationship_view') },
              { value: 'details', label: t('erd_details') },
            ]}
          />
          <Button
            className="erd-auto-layout-btn"
            size="small"
            icon={<ApartmentOutlined />}
            onClick={handleAutoLayout}
          >
            {t('erd_auto_layout')}
          </Button>
          {onDetectRelationships ? (
            <Button
              className="erd-auto-layout-btn"
              size="small"
              icon={<RadarChartOutlined />}
              loading={isDetectingRelationships}
              onClick={onDetectRelationships}
            >
              {t('modeling_detect_relationships')}
            </Button>
          ) : null}
        </div>
        <Input
          size="small"
          prefix={<SearchOutlined />}
          placeholder={t('erd_search_schema')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          className="erd-search"
        />
      </div>
      {filteredTables.length === 0 ? (
        <div className="erd-empty-state">
          <TableOutlined />
          <span>{t('erd_no_matching_tables')}</span>
        </div>
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onPaneClick={() => setPendingColumn(null)}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onInit={(instance) => { rfInstanceRef.current = instance; }}
        fitView
        minZoom={0.3}
        maxZoom={1}
        proOptions={{ hideAttribution: true }}
        colorMode={isDarkMode ? 'dark' : 'light'}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
