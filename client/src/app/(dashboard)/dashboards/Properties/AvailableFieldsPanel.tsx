'use client';

import React, { useMemo, useState } from 'react';
import { Input, Tag, Tooltip } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { PpLabel } from './PpLabel';
import { setDashboardFieldDragData } from '../utils/dashboardFieldDrag';

export type FieldOption = {
  label: React.ReactNode;
  value: string;
  type?: string;
};

function normalizeType(type?: string): string {
  const upper = String(type || '').toUpperCase();
  if (!upper || upper === 'UNKNOWN') return 'Text';
  if (upper.includes('INT') || upper.includes('SERIAL')) return 'Number';
  if (
    upper.includes('DECIMAL') ||
    upper.includes('NUMERIC') ||
    upper.includes('DOUBLE') ||
    upper.includes('FLOAT') ||
    upper.includes('REAL') ||
    upper.includes('NUMBER')
  ) {
    return 'Decimal';
  }
  if (upper.includes('DATE') || upper.includes('TIME')) return 'Date';
  if (upper.includes('BOOL')) return 'Boolean';
  return 'Text';
}

function typeColor(kind: string): string {
  switch (kind) {
    case 'Number':
    case 'Decimal':
      return 'blue';
    case 'Date':
      return 'purple';
    case 'Boolean':
      return 'orange';
    default:
      return 'default';
  }
}

function groupKey(kind: string): string {
  if (kind === 'Number' || kind === 'Decimal') return 'Numbers';
  if (kind === 'Date') return 'Dates';
  if (kind === 'Boolean') return 'Boolean';
  return 'Text';
}

const GROUP_ORDER = ['Numbers', 'Dates', 'Text', 'Boolean'];

type Props = {
  columns: FieldOption[];
  dataSourceId?: string | null;
  tableName?: string;
  loading?: boolean;
};

/**
 * Compact field browser in Build — typed groups, search, drag onto shelves.
 */
export function AvailableFieldsPanel({ columns, dataSourceId, tableName, loading }: Props) {
  const t = useTranslations('dashboards');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return columns;
    return columns.filter((c) => {
      const name = String(c.value || '').toLowerCase();
      const typ = String(c.type || '').toLowerCase();
      return name.includes(needle) || typ.includes(needle);
    });
  }, [columns, q]);

  const grouped = useMemo(() => {
    const buckets: Record<string, FieldOption[]> = {};
    for (const col of filtered) {
      const g = groupKey(normalizeType(col.type));
      if (!buckets[g]) buckets[g] = [];
      buckets[g].push(col);
    }
    return GROUP_ORDER.filter((g) => buckets[g]?.length).map((g) => ({
      group: g,
      items: buckets[g],
    }));
  }, [filtered]);

  if (!loading && columns.length === 0) return null;

  return (
    <div className="pp-fields-panel">
      <PpLabel>{t('available_fields_label')}</PpLabel>
      <Input
        size="small"
        allowClear
        prefix={<SearchOutlined style={{ color: 'var(--ant-color-text-quaternary)' }} />}
        placeholder={t('available_fields_search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 6 }}
      />
      <div className="pp-fields-list" aria-busy={loading}>
        {loading ? (
          <div className="pp-fields-empty">{t('available_fields_loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="pp-fields-empty">{t('available_fields_none')}</div>
        ) : (
          grouped.map(({ group, items }) => (
            <div key={group} className="pp-fields-group">
              <div className="pp-fields-group-label">{group}</div>
              <div className="pp-fields-group-chips">
                {items.map((col) => {
                  const kind = normalizeType(col.type);
                  const name = String(col.value);
                  return (
                    <Tooltip key={name} title={name}>
                      <button
                        type="button"
                        className="pp-field-chip"
                        draggable={Boolean(dataSourceId)}
                        onDragStart={(event) => {
                          if (!dataSourceId) return;
                          setDashboardFieldDragData(event.dataTransfer, {
                            dataSourceId: String(dataSourceId),
                            tableName,
                            columnName: name,
                            columnType: col.type,
                            label: name,
                          });
                        }}
                      >
                        <span className="pp-field-chip-name">{name}</span>
                        <Tag className="pp-field-chip-type" color={typeColor(kind)}>
                          {kind}
                        </Tag>
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default AvailableFieldsPanel;
