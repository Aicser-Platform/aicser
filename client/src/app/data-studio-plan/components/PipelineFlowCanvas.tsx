'use client';

import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  DatabaseOutlined,
  InboxOutlined,
  SafetyCertificateOutlined,
  TableOutlined,
  CrownOutlined,
  RobotOutlined,
  CheckCircleFilled,
  WarningFilled,
  SyncOutlined,
  CloudUploadOutlined,
  ApartmentOutlined,
  ClusterOutlined,
} from '@ant-design/icons';
import { Tag } from 'antd';
import { MOCK_PIPELINE_NODES, type PipelineNodeData } from '../data/mockPipelineData';

interface CanvasNodeProps {
  data: PipelineNodeData & {
    isSelected: boolean;
    onSelect: (id: string) => void;
  };
}

function CustomPipelineNode({ data }: CanvasNodeProps) {
  const isSelected = data.isSelected;

  const getIcon = () => {
    switch (data.type) {
      case 'source_group':
      case 'source':
        return <DatabaseOutlined style={{ color: data.accentColor, fontSize: 16 }} />;
      case 'bronze':
        return <InboxOutlined style={{ color: data.accentColor, fontSize: 16 }} />;
      case 'quality':
        return <SafetyCertificateOutlined style={{ color: data.accentColor, fontSize: 16 }} />;
      case 'silver':
        return <TableOutlined style={{ color: data.accentColor, fontSize: 16 }} />;
      case 'gold':
        return <CrownOutlined style={{ color: data.accentColor, fontSize: 16 }} />;
      case 'destination':
        return data.id.includes('genbi') ? (
          <RobotOutlined style={{ color: data.accentColor, fontSize: 16 }} />
        ) : (
          <CloudUploadOutlined style={{ color: data.accentColor, fontSize: 16 }} />
        );
      default:
        return <TableOutlined style={{ color: data.accentColor, fontSize: 16 }} />;
    }
  };

  const getStatusBadge = () => {
    if (data.status === 'running') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#0284c7' }}>
          <SyncOutlined spin style={{ fontSize: 11 }} /> Syncing
        </span>
      );
    }
    if (data.status === 'warning') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#f59e0b' }}>
          <WarningFilled style={{ fontSize: 11 }} /> 22 Quarantined
        </span>
      );
    }
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#10b981' }}>
        <CheckCircleFilled style={{ fontSize: 11 }} /> Healthy
      </span>
    );
  };

  return (
    <div
      onClick={() => data.onSelect(data.id)}
      style={{
        width: 270,
        borderRadius: 10,
        background: 'var(--ant-color-bg-container, #ffffff)',
        border: isSelected ? '2px solid #00c2cb' : '1px solid var(--ant-color-border-secondary, #e2e8f0)',
        boxShadow: isSelected
          ? '0 0 0 3px rgba(0, 194, 203, 0.25), 0 8px 16px -4px rgba(0, 0, 0, 0.1)'
          : '0 2px 6px -1px rgba(0, 0, 0, 0.05)',
        cursor: 'pointer',
        transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
      }}
    >
      {/* Input Handle */}
      {data.type !== 'source' && data.type !== 'source_group' && (
        <Handle
          type="target"
          position={Position.Left}
          style={{
            background: data.accentColor,
            width: 9,
            height: 9,
            borderRadius: '50%',
            border: '2px solid #ffffff',
            left: -5,
          }}
        />
      )}

      {/* Top Layer Accent Stripe */}
      <div style={{ height: 3, background: data.accentColor }} />

      <div style={{ padding: '10px 12px' }}>
        {/* Header Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {getIcon()}
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: data.accentColor,
              }}
            >
              {data.layerLabel}
            </span>
          </div>
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 4,
              fontWeight: 600,
              background: 'var(--ant-color-fill-secondary, rgba(0,0,0,0.04))',
              color: 'var(--ant-color-text-secondary, #64748b)',
            }}
          >
            {data.tag}
          </span>
        </div>

        {/* Node Name */}
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ant-color-text, #0f172a)',
            marginBottom: 6,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={data.name}
        >
          {data.name}
        </div>

        {/* Multi-Table Badges if applicable */}
        {data.tablesList && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {data.tablesList.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 10,
                  fontFamily: 'monospace',
                  background: 'rgba(59, 130, 246, 0.08)',
                  color: '#2563eb',
                  padding: '1px 5px',
                  borderRadius: 3,
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Subtitle / Mode / Details */}
        <div
          style={{
            fontSize: 11,
            color: 'var(--ant-color-text-secondary, #64748b)',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{data.details.mode || data.details.format || 'Table'}</span>
          {data.duration && <span style={{ fontFamily: 'monospace', fontSize: 10 }}>{data.duration}</span>}
        </div>

        {/* Footer Row: Status + Row Count */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 6,
            borderTop: '1px solid var(--ant-color-border-secondary, #f1f5f9)',
          }}
        >
          {getStatusBadge()}
          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'monospace', color: 'var(--ant-color-text, #0f172a)' }}>
            {data.rowCount.toLocaleString()} rows
          </span>
        </div>
      </div>

      {/* Output Handle */}
      {data.type !== 'destination' && (
        <Handle
          type="source"
          position={Position.Right}
          style={{
            background: data.accentColor,
            width: 9,
            height: 9,
            borderRadius: '50%',
            border: '2px solid #ffffff',
            right: -5,
          }}
        />
      )}
    </div>
  );
}

const nodeTypes = {
  customNode: CustomPipelineNode,
};

export interface PipelineFlowCanvasProps {
  selectedNodeId: string;
  onSelectNode: (id: string) => void;
  multiSourceMode?: boolean;
}

export function PipelineFlowCanvas({ selectedNodeId, onSelectNode }: PipelineFlowCanvasProps) {
  const nodes: Node[] = useMemo(() => {
    return [
      {
        id: 'source-postgres-group',
        type: 'customNode',
        position: { x: 30, y: 70 },
        data: {
          ...MOCK_PIPELINE_NODES['source-postgres-group'],
          isSelected: selectedNodeId === 'source-postgres-group',
          onSelect: onSelectNode,
        },
      },
      {
        id: 'source-stripe',
        type: 'customNode',
        position: { x: 30, y: 250 },
        data: {
          ...MOCK_PIPELINE_NODES['source-stripe'],
          isSelected: selectedNodeId === 'source-stripe',
          onSelect: onSelectNode,
        },
      },
      {
        id: 'bronze-raw',
        type: 'customNode',
        position: { x: 370, y: 160 },
        data: {
          ...MOCK_PIPELINE_NODES['bronze-raw'],
          isSelected: selectedNodeId === 'bronze-raw',
          onSelect: onSelectNode,
        },
      },
      {
        id: 'quality-gate',
        type: 'customNode',
        position: { x: 700, y: 160 },
        data: {
          ...MOCK_PIPELINE_NODES['quality-gate'],
          isSelected: selectedNodeId === 'quality-gate',
          onSelect: onSelectNode,
        },
      },
      {
        id: 'silver-cleaned',
        type: 'customNode',
        position: { x: 1030, y: 160 },
        data: {
          ...MOCK_PIPELINE_NODES['silver-cleaned'],
          isSelected: selectedNodeId === 'silver-cleaned',
          onSelect: onSelectNode,
        },
      },
      {
        id: 'gold-mrr',
        type: 'customNode',
        position: { x: 1360, y: 160 },
        data: {
          ...MOCK_PIPELINE_NODES['gold-mrr'],
          isSelected: selectedNodeId === 'gold-mrr',
          onSelect: onSelectNode,
        },
      },
      {
        id: 'dest-snowflake',
        type: 'customNode',
        position: { x: 1690, y: 80 },
        data: {
          ...MOCK_PIPELINE_NODES['dest-snowflake'],
          isSelected: selectedNodeId === 'dest-snowflake',
          onSelect: onSelectNode,
        },
      },
      {
        id: 'dest-genbi',
        type: 'customNode',
        position: { x: 1690, y: 240 },
        data: {
          ...MOCK_PIPELINE_NODES['dest-genbi'],
          isSelected: selectedNodeId === 'dest-genbi',
          onSelect: onSelectNode,
        },
      },
    ];
  }, [selectedNodeId, onSelectNode]);

  const edges: Edge[] = useMemo(() => {
    return [
      {
        id: 'e-pg-bronze',
        source: 'source-postgres-group',
        target: 'bronze-raw',
        animated: true,
        label: '4 Tables Extracted',
        labelStyle: { fill: '#3b82f6', fontSize: 10, fontWeight: 600 },
        style: { stroke: '#3b82f6', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
      },
      {
        id: 'e-stripe-bronze',
        source: 'source-stripe',
        target: 'bronze-raw',
        animated: true,
        label: 'Webhook Stream',
        labelStyle: { fill: '#6366f1', fontSize: 10, fontWeight: 600 },
        style: { stroke: '#6366f1', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
      },
      {
        id: 'e-bronze-quality',
        source: 'bronze-raw',
        target: 'quality-gate',
        animated: true,
        style: { stroke: '#ea580c', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#ea580c' },
      },
      {
        id: 'e-quality-silver',
        source: 'quality-gate',
        target: 'silver-cleaned',
        label: 'Multi-Source Conformed Join (99.95%)',
        labelStyle: { fill: '#10b981', fontSize: 10, fontWeight: 600 },
        style: { stroke: '#10b981', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
      },
      {
        id: 'e-silver-gold',
        source: 'silver-cleaned',
        target: 'gold-mrr',
        animated: true,
        label: 'Star Schema Materialization',
        labelStyle: { fill: '#0284c7', fontSize: 10, fontWeight: 600 },
        style: { stroke: '#0284c7', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#0284c7' },
      },
      {
        id: 'e-gold-snowflake',
        source: 'gold-mrr',
        target: 'dest-snowflake',
        label: 'Reverse-ETL Mirror',
        labelStyle: { fill: '#38bdf8', fontSize: 10, fontWeight: 600 },
        style: { stroke: '#38bdf8', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#38bdf8' },
      },
      {
        id: 'e-gold-genbi',
        source: 'gold-mrr',
        target: 'dest-genbi',
        label: 'Semantic Grounding',
        labelStyle: { fill: '#8b5cf6', fontSize: 10, fontWeight: 600 },
        style: { stroke: '#8b5cf6', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' },
      },
    ];
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="rgba(100, 116, 139, 0.2)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
