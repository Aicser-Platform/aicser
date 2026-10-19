'use client';

import React from 'react';
import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { CellType } from '@/services/notebookService';
import { TYPE_ICON } from './NotebookCell';

export function BlockHandle({
  disabled,
  onInsert,
}: {
  disabled?: boolean;
  onInsert: (type: CellType) => void;
}) {
  const t = useTranslations('notebooks');
  const items: MenuProps['items'] = [
    { key: 'markdown', icon: TYPE_ICON.markdown, label: t('slash_markdown') },
    { key: 'python', icon: TYPE_ICON.python, label: t('slash_python') },
    { key: 'sql', icon: TYPE_ICON.sql, label: t('slash_sql') },
    { type: 'divider' },
    { key: 'chart', icon: TYPE_ICON.chart, label: t('slash_chart') },
    { key: 'pivot', icon: TYPE_ICON.pivot, label: t('slash_pivot') },
  ];

  return (
    <Dropdown
      trigger={['click']}
      disabled={disabled}
      menu={{
        items,
        onClick: ({ key }) => onInsert(key as CellType),
      }}
    >
      <button type="button" className="nb-block-handle" aria-label={t('add_cell')} disabled={disabled}>
        <PlusOutlined />
      </button>
    </Dropdown>
  );
}
