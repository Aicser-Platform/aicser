'use client';

import React, { useMemo, useState } from 'react';
import { Input, Tag, Tooltip } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
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

/** Identifiers (id, *_id, *_key) are for joining and counting, not adding up, so they get their
 * own group instead of sitting among the numbers (Tableau / Power BI treat them as dimensions). */
function isIdentifier(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'id' || n.endsWith('_id') || n.endsWith('_key') || n.endsWith('uuid');
}

function groupKey(kind: string, name = ''): string {
  if (isIdentifier(name)) return 'IDs';
  if (kind === 'Number' || kind === 'Decimal') return 'Numbers';
  if (kind === 'Date') return 'Dates';
  if (kind === 'Boolean') return 'Boolean';
  return 'Text';
}

const GROUP_ORDER = ['Numbers', 'Dates', 'Text', 'Boolean', 'IDs'];
const GROUP_LABEL_KEYS: Record<string, string> = {
  Numbers: 'fields_group_numbers',
  Dates: 'fields_group_dates',
  Text: 'fields_group_text',
  Boolean: 'fields_group_boolean',
  IDs: 'fields_group_ids',
};
const TYPE_LABEL_KEYS: Record<string, string> = {
  Number: 'field_type_number',
  Decimal: 'field_type_decimal',
  Date: 'field_type_date',
  Boolean: 'field_type_boolean',
  Text: 'field_type_text',
};

type Props = {
  columns: FieldOption[];
  dataSourceId?: string | null;
  tableName?: string;
  loading?: boolean;
};

/**
 * Every field of the table, grouped by kind, to drag onto the shelves. Folded by default: the
 * shelves' own pickers already list and search these fields, so newcomers never need it; people
 * who like drag and drop open it once (remembered for the session).
 */
export function AvailableFieldsPanel({ columns, dataSourceId, tableName, loading }: Props) {
  const t = useTranslations('dashboards');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem('pp-fields-open') === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setOpen((v) => {
      try {
        sessionStorage.setItem('pp-fields-open', v ? '0' : '1');
      } catch {
        /* per-tab convenience only */
      }
      return !v;
    });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return columns;
    return columns.filter((c) => {
      const name = String(c.value || '').toLowerCase();
      const label = String(c.label || '').toLowerCase();
      const typ = String(c.type || '').toLowerCase();
      return name.includes(needle) || label.includes(needle) || typ.includes(needle);
    });
  }, [columns, q]);

  const grouped = useMemo(() => {
    const buckets: Record<string, FieldOption[]> = {};
    for (const col of filtered) {
      const g = groupKey(normalizeType(col.type), String(col.value || ''));
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
      <button type="button" className="pp-fields-toggle" aria-expanded={open} onClick={toggle}>
        <span className="pp-fields-toggle-caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        {t('available_fields_label')}
        {!loading ? <span className="pp-fields-toggle-count">{columns.length}</span> : null}
      </button>
      {open ? (
        <>
          {columns.length > 12 ? (
            <Input
              size="small"
              allowClear
              prefix={<SearchOutlined style={{ color: 'var(--ant-color-text-quaternary)' }} />}
              placeholder={t('available_fields_search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ marginBottom: 6 }}
            />
          ) : null}
          <div className="pp-fields-list" aria-busy={loading}>
            {loading ? (
              <div className="pp-fields-empty">{t('available_fields_loading')}</div>
            ) : filtered.length === 0 ? (
              <div className="pp-fields-empty">{t('available_fields_none')}</div>
            ) : (
              grouped.map(({ group, items }) => (
                <div key={group} className="pp-fields-group">
                  <div className="pp-fields-group-label">{t(GROUP_LABEL_KEYS[group] as never)}</div>
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
                                label: String(col.label || name),
                              });
                            }}
                          >
                            <span className="pp-field-chip-name">{String(col.label || name)}</span>
                            <Tag className="pp-field-chip-type" color={typeColor(kind)}>
                              {t(TYPE_LABEL_KEYS[kind] as never)}
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
        </>
      ) : null}
    </div>
  );
}

export default AvailableFieldsPanel;
