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
import { cn } from '@/lib/ui/utils';

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

  // Same line and label as the semantic model diagram; the line's colour comes from the flow theme (styles/flow.css).
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={data?.cardinality === 'many_to_many' ? { strokeDasharray: '6 3' } : undefined}
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
      <EdgeLabelRenderer>
        {/* Positioned box first: the scope element is display:contents and can't carry the position. */}
        <div
          className="nodrag nopan"
          style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
        >
          <div className="aicser-ui">
            <button
              type="button"
              onClick={() => data?.onSelect?.(data.relationshipId)}
              className={cn(
                'rounded border bg-card px-1.5 py-0.5 font-mono text-[10px] text-card-foreground shadow-sm hover:border-primary',
                selected && 'border-primary text-primary-hover dark:text-primary'
              )}
            >
              {label}
            </button>
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
