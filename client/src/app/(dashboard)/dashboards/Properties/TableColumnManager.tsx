'use client';

import React, { useMemo } from 'react';
import { Checkbox, Typography } from 'antd';
import { useTranslations } from 'next-intl';

type ColumnOption = { label: string; value: string };

type Props = {
  columns: ColumnOption[];
  visibleKeys?: string[];
  onChange: (keys: string[]) => void;
};

/** Pick which table columns appear in the widget. */
export function TableColumnManager({ columns, visibleKeys, onChange }: Props) {
  const t = useTranslations('properties_panel');
  const selected = useMemo(() => {
    if (visibleKeys?.length) return new Set(visibleKeys);
    return new Set(columns.map((c) => c.value));
  }, [columns, visibleKeys]);

  if (!columns.length) return null;

  const toggle = (key: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    onChange([...next]);
  };

  return (
    <div className="table-column-manager">
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        {t('table_columns_hint')}
      </Typography.Text>
      <div className="table-column-manager-list">
        {columns.map((col) => (
          <label key={col.value} className="table-column-manager-row">
            <Checkbox
              checked={selected.has(col.value)}
              onChange={(e) => toggle(col.value, e.target.checked)}
            />
            <span>{col.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default TableColumnManager;
