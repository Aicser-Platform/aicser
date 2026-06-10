import React from 'react';
import {
  FieldBinaryOutlined,
  FieldNumberOutlined,
  FieldStringOutlined,
  FieldTimeOutlined,
  NumberOutlined,
  TagOutlined,
} from '@ant-design/icons';

export type ColumnTypeFamily = 'time' | 'string' | 'number' | 'bool' | 'array' | 'symbol' | 'other';

export function getColumnTypeFamily(type: string): ColumnTypeFamily {
  const t = (type || '').toLowerCase();
  if (t.includes('timestamp') || t.includes('datetime') || t === 'date' || t.includes('time')) return 'time';
  if (t.includes('[]') || t.includes('array')) return 'array';
  if (t.includes('symbol') || t.includes('enum')) return 'symbol';
  if (t.includes('bool')) return 'bool';
  if (
    t.includes('int') ||
    t.includes('float') ||
    t.includes('double') ||
    t.includes('decimal') ||
    t.includes('numeric') ||
    t.includes('real') ||
    t.includes('number')
  ) {
    return 'number';
  }
  if (t.includes('char') || t.includes('text') || t.includes('string') || t.includes('uuid')) return 'string';
  return 'other';
}

export function abbreviateSqlType(type: string): string {
  const raw = (type || '').trim();
  if (!raw) return '';
  if (raw.length > 28) return `${raw.slice(0, 26)}…`;
  return raw;
}

export function ColumnTypeIcon({ type, className }: { type: string; className?: string }) {
  const family = getColumnTypeFamily(type);
  const cls = `schema-explorer-type-icon schema-explorer-type-icon--${family}${className ? ` ${className}` : ''}`;
  switch (family) {
    case 'time':
      return <FieldTimeOutlined className={cls} aria-hidden />;
    case 'symbol':
      return <TagOutlined className={cls} aria-hidden />;
    case 'array':
      return <FieldBinaryOutlined className={cls} aria-hidden />;
    case 'number':
      return <NumberOutlined className={cls} aria-hidden />;
    case 'bool':
      return <FieldBinaryOutlined className={cls} aria-hidden />;
    case 'string':
      return <FieldStringOutlined className={cls} aria-hidden />;
    default:
      return <FieldNumberOutlined className={cls} aria-hidden />;
  }
}
