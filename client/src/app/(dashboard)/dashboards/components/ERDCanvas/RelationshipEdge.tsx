'use client';

import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
  Position,
} from '@xyflow/react';

export type RelationshipEdgeData = {
  cardinality: string;
  relationshipId: string;
  onSelect: (id: string) => void;
};

const CARDINALITY_LABEL: Record<string, string> = {
  one_to_one: '1:1',
  one_to_many: '1:N',
  many_to_many: 'N:N',
};

export function RelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<Edge<RelationshipEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: sourcePosition ?? Position.Right,
    targetX,
    targetY,
    targetPosition: targetPosition ?? Position.Left,
  });

  const label = CARDINALITY_LABEL[data?.cardinality ?? 'one_to_many'] ?? '1:N';
  const color = selected ? 'var(--ant-color-primary)' : '#6b7280';

  return (
    <>
      {/* Visible line */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: data?.cardinality === 'many_to_many' ? '6 3' : undefined,
          transition: 'stroke 160ms, stroke-width 160ms',
        }}
        markerEnd={`url(#rel-arrow-${selected ? 'selected' : 'default'})`}
      />
      {/* Wide transparent hit area for easy clicking */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ cursor: 'pointer' }}
        onClick={() => data?.onSelect?.(data.relationshipId)}
      />
      {/* Cardinality label */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            background: selected ? 'var(--ant-color-primary-bg)' : 'var(--ant-color-bg-container)',
            border: `1px solid ${selected ? 'var(--ant-color-primary-border)' : 'var(--ant-color-border)'}`,
            borderRadius: 4,
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'ui-monospace, monospace',
            color,
            pointerEvents: 'none',
            letterSpacing: '0.04em',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
          className="nodrag nopan"
        >
          {label}
        </div>
      </EdgeLabelRenderer>
      {/* SVG arrow marker defs — injected once, reused by all edges */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <marker
            id="rel-arrow-default"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L8,3 z" fill="#6b7280" />
          </marker>
          <marker
            id="rel-arrow-selected"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L8,3 z" fill="var(--ant-color-primary)" />
          </marker>
        </defs>
      </svg>
    </>
  );
}
