'use client';

import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { KeyOutlined, LinkOutlined, MoreOutlined } from '@ant-design/icons';
import './ERDCanvas.css';

export type TableNodeData = {
  tableId?: string;
  tableName: string;
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
  const { tableId = data.tableName, tableName, columns } = data;

  return (
    <div className={`erd-table${selected ? ' selected' : ''}`}>
      {/* Header */}
      <div className="erd-table-header">
        <span className="erd-table-name" title={tableName}>
          {tableName}
        </span>
        <button className="erd-table-menu nodrag" aria-label="Table options">
          <MoreOutlined />
        </button>
      </div>

      {/* Column count subtitle */}
      <div className="erd-table-subtitle">{columns.length} columns</div>

      {/* Columns */}
      <div className="erd-table-body">
        {columns.map((col) => {
          const handleId = `${tableId}__${col.name}`;
          const role = colRole(col);
          return (
            <div key={col.name} className={`erd-col${role === 'pk' ? ' erd-col-pk' : role === 'fk' ? ' erd-col-fk' : ''}`}>
              {/* Left port — incoming FK target */}
              <Handle
                type="target"
                position={Position.Left}
                id={`${handleId}__target`}
                className="erd-port erd-port-left"
              />

              <span className="erd-col-key" aria-hidden="true">
                {role === 'pk' && <KeyOutlined className="erd-col-key-pk" />}
                {role === 'fk' && <LinkOutlined className="erd-col-key-fk" />}
              </span>
              <span className="erd-col-name" title={col.name}>
                {col.name}
              </span>
              {role && (
                <span className={`erd-col-role erd-col-role-${role}`}>{role.toUpperCase()}</span>
              )}
              <span className={`erd-col-type erd-col-type-${typeFamily(col.type)}`}>
                {displayType(col.type)}
              </span>

              {/* Right port — outgoing FK source */}
              <Handle
                type="source"
                position={Position.Right}
                id={handleId}
                className="erd-port erd-port-right"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
