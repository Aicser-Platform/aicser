'use client';

import React, { useEffect, useState } from 'react';
import { Select, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { listRelationships, type DataModelRelationship } from '@/api/dataModel';

export type JoinOnSpec = { left: string; right: string };

export type JoinSpec = {
  table: string;
  alias?: string;
  on: JoinOnSpec | string;
  type: string;
};

type Props = {
  dataSourceId?: string;
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

export function RelatedJoinsPicker({ dataSourceId, joins = [], onChange }: Props) {
  const t = useTranslations('dashboards');
  const [relationships, setRelationships] = useState<DataModelRelationship[]>([]);

  useEffect(() => {
    if (!dataSourceId) return;
    void listRelationships(dataSourceId).then(setRelationships).catch(() => setRelationships([]));
  }, [dataSourceId]);

  if (!dataSourceId || relationships.length === 0) return null;

  const options = relationships.map((r) => {
    const key = `${r.from_table}.${r.from_column}-${r.to_table}.${r.to_column}`;
    const join: JoinSpec = {
      table: r.to_table,
      type: (r.join_type || 'LEFT').toUpperCase(),
      on: {
        left: `${r.from_table}.${r.from_column}`,
        right: `${r.to_table}.${r.to_column}`,
      },
    };
    return {
      value: key,
      label: `${r.from_table} → ${r.to_table} (${r.join_type || 'LEFT'})`,
      join,
    };
  });

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
