'use client';

import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { KeyRound, Link2 } from 'lucide-react';
import { AicserUi } from '@/components/aicser-ui/scope';
import { cn } from '@/lib/ui/utils';
import { useTranslations } from 'next-intl';
import './ERDCanvas.css';

export type TableNodeData = {
  tableId?: string;
  tableName: string;
  rawTableName?: string;
  sourceId?: string;
  columnFilter?: string;
  pendingColumnKey?: string | null;
  onColumnPick?: (column: { nodeId: string; tableName: string; sourceId: string; columnName: string }) => void;
  columns: { name: string; type: string; primary_key?: boolean; foreign_key?: string }[];
};

function displayType(type: string): string {
  const upper = type.toUpperCase();
  if (upper.includes('VARCHAR') || upper.includes('CHAR')) return 'TEXT';
  if (upper.includes('TIMESTAMP')) return 'TIMESTAMP';
  if (upper.includes('DATETIME')) return 'DATETIME';
  if (upper.includes('DATE')) return 'DATE';
  if (upper.includes('TIME')) return 'TIME';
  if (upper.includes('DOUBLE') || upper.includes('FLOAT') || upper.includes('REAL')) return 'DECIMAL';
  if (upper.includes('DECIMAL') || upper.includes('NUMERIC')) return 'DECIMAL';
  if (upper.includes('BIGINT')) return 'BIGINT';
  if (upper.includes('INT')) return 'INT';
  if (upper.includes('BOOLEAN') || upper.includes('BOOL')) return 'BOOL';
  if (upper.includes('JSON')) return 'JSON';
  if (upper.includes('UUID')) return 'UUID';
  if (upper.includes('NUMBER')) return 'NUM';
  if (upper.includes('STRING')) return 'TEXT';
  return upper.length > 9 ? upper.slice(0, 8) + '…' : upper;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the type colours' callers
function typeFamily(type: string): string {
  const upper = type.toUpperCase();
  if (
    upper.includes('INT') ||
    upper.includes('DECIMAL') ||
    upper.includes('NUMERIC') ||
    upper.includes('DOUBLE') ||
    upper.includes('FLOAT') ||
    upper.includes('NUMBER') ||
    upper.includes('REAL')
  )
    return 'number';
  if (upper.includes('DATE') || upper.includes('TIME')) return 'date';
  if (upper.includes('BOOL')) return 'bool';
  if (upper.includes('UUID')) return 'id';
  return 'text';
}

type ColRole = 'pk' | 'fk' | null;

function colRole(col: { name: string; primary_key?: boolean; foreign_key?: string }): ColRole {
  if (col.primary_key === true || col.name.toLowerCase() === 'id') return 'pk';
  if (col.foreign_key || col.name.toLowerCase().endsWith('_id')) return 'fk';
  return null;
}

export function TableNode({ data, selected }: NodeProps<Node<TableNodeData>>) {
  const t = useTranslations('dashboards_page');
  const {
    tableId = data.tableName,
    tableName,
    rawTableName = tableName,
    sourceId = tableId,
    columnFilter = '',
    pendingColumnKey,
    onColumnPick,
    columns,
  } = data;
  const normalizedFilter = columnFilter.trim().toLowerCase();
  const visibleColumns = normalizedFilter
    ? columns.filter((col) => col.name.toLowerCase().includes(normalizedFilter))
    : columns;

  // Same card as the semantic model diagram (components/semantic-studio/RelationshipDiagram): name and column count,
  // then one row per column with its key mark and type. Clicking a column starts / finishes a join.
  return (
    <AicserUi>
      <div
        className={cn(
          'w-[248px] overflow-visible rounded-lg border bg-card text-card-foreground shadow-sm',
          selected && 'ring-2 ring-primary'
        )}
        role="group"
        aria-label={tableName}
      >
        <div className="flex h-11 cursor-grab flex-col justify-center border-b px-3 active:cursor-grabbing">
          <p className="m-0 truncate text-sm font-semibold" title={tableName}>
            {tableName}
          </p>
          <p className="m-0 text-[10px] text-muted-foreground">{columns.length} columns</p>
        </div>
        {/* Long tables scroll inside the card (nowheel: the wheel scrolls the list, not the canvas). */}
        <div className="nowheel max-h-[280px] overflow-y-auto">
          {visibleColumns.map((col) => {
            const handleId = `${tableId}__${col.name}`;
            const isPending = pendingColumnKey === handleId;
            const role = colRole(col);
            const pick = () =>
              onColumnPick?.({ nodeId: tableId, tableName: rawTableName, sourceId, columnName: col.name });
            return (
              <div
                key={col.name}
                role="button"
                tabIndex={0}
                title={col.name}
                className={cn(
                  'nodrag nopan relative flex h-[26px] cursor-pointer items-center gap-1.5 px-3 text-xs outline-none hover:bg-accent focus-visible:bg-accent',
                  isPending && 'bg-primary/15 ring-1 ring-inset ring-primary'
                )}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('.react-flow__handle')) return;
                  pick();
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  pick();
                }}
              >
                {/* Left: incoming join; right: outgoing join */}
                <Handle type="target" position={Position.Left} id={`${handleId}__target`} data-joined={role !== null} />
                {role === 'pk' ? (
                  <KeyRound className="size-3 shrink-0 text-primary" aria-label="PK" />
                ) : role === 'fk' ? (
                  <Link2 className="size-3 shrink-0 text-muted-foreground" aria-label="FK" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{col.name}</span>
                <span className="max-w-24 truncate text-[10px] uppercase text-muted-foreground" title={col.type}>
                  {displayType(col.type)}
                </span>
                <Handle type="source" position={Position.Right} id={handleId} data-joined={role !== null} />
              </div>
            );
          })}
          {visibleColumns.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{t('modeling_no_matching_fields')}</div>
          ) : null}
        </div>
      </div>
    </AicserUi>
  );
}
