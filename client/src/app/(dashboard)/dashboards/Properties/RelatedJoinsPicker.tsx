'use client';

import React from 'react';
import { Select, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { type DataModelRelationship } from '@/api/dataModel';
import { useRelationships } from '@/hooks/useDataModelRelationships';

export type JoinOnSpec = { left: string; right: string };

export type JoinSpec = {
  table: string;
  alias?: string;
  on: JoinOnSpec | string;
  type: string;
};

type Props = {
  dataSourceId?: string;
  baseTable?: string;
  joins?: JoinSpec[];
  onChange: (joins: JoinSpec[]) => void;
};

function joinKey(join: JoinSpec): string {
  if (join.on && typeof join.on === 'object') {
    return `${join.on.left}-${join.on.right}`;
  }
  if (typeof join.on === 'string') {
    return join.on.replace(/\s+/g, '');
  }
  return `${join.table}`;
}

function normalizeJoin(join: JoinSpec): JoinSpec {
  if (join.on && typeof join.on === 'object') {
    return join;
  }
  if (typeof join.on === 'string' && join.on.includes('=')) {
    const [left, right] = join.on.split('=').map((s) => s.trim());
    if (left && right) {
      return { ...join, on: { left, right } };
    }
  }
  return join;
}

function bareTableName(table?: string): string {
  if (!table) return '';
  return table.split('.').pop()?.trim() || table.trim();
}

function buildJoinForBase(r: DataModelRelationship, baseTable?: string): JoinSpec {
  const base = bareTableName(baseTable);
  const fromTable = bareTableName(r.from_table);
  const toTable = bareTableName(r.to_table);
  const isReverse = base === toTable;
  const table = isReverse ? fromTable : toTable;

  return {
    table,
    alias: table,
    type: (r.join_type || 'LEFT').toUpperCase(),
    on: {
      left: `${fromTable}.${r.from_column}`,
      right: `${toTable}.${r.to_column}`,
    },
  };
}

export function RelatedJoinsPicker({ dataSourceId, baseTable, joins = [], onChange }: Props) {
  const t = useTranslations('dashboards');
  const { data: relationships = [] } = useRelationships(dataSourceId);

  if (!dataSourceId || relationships.length === 0) return null;

  const base = bareTableName(baseTable);
  const options = relationships
    .filter((r) => {
      if (!base) return true;
      return bareTableName(r.from_table) === base || bareTableName(r.to_table) === base;
    })
    .map((r) => {
    const key = `${r.from_table}.${r.from_column}-${r.to_table}.${r.to_column}`;
    const join = buildJoinForBase(r, baseTable);
    const relatedTable = join.table;
    return {
      value: key,
      label: `${relatedTable} (${r.from_column} → ${r.to_column})`,
      join,
    };
  });

  if (options.length === 0) return null;

  const normalizedJoins = joins.map(normalizeJoin);
  const selectedKeys = normalizedJoins.map(joinKey);

  return (
    <div style={{ marginTop: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        {t('related_tables')}
      </Typography.Text>
      <Select
        mode="multiple"
        style={{ width: '100%' }}
        placeholder={t('select_related_tables')}
        options={options}
        value={selectedKeys}
        onChange={(keys) => {
          const next = options.filter((o) => keys.includes(o.value)).map((o) => o.join);
          onChange(next);
        }}
      />
    </div>
  );
}

export default RelatedJoinsPicker;
