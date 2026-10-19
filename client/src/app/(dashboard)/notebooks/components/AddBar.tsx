'use client';

import React from 'react';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { CellType } from '@/services/notebookService';
import { TYPE_ICON } from './NotebookCell';

export function AddBar({
  onAdd,
  label,
  end = false,
}: {
  onAdd: (type: CellType) => void;
  label: string;
  end?: boolean;
}) {
  const t = useTranslations('notebooks');
  const moreItems: MenuProps['items'] = [
    { key: 'sql', icon: TYPE_ICON.sql, label: t('type_sql') },
    { key: 'chart', icon: TYPE_ICON.chart, label: t('type_chart') },
    { key: 'pivot', icon: TYPE_ICON.pivot, label: t('type_pivot') },
  ];

  return (
    <div className={`nb-add${end ? ' nb-add--end' : ''}`} role="group" aria-label={label}>
      <Button className="nb-add__pill" size="small" icon={TYPE_ICON.python} onClick={() => onAdd('python')}>
        + {t('add_code')}
      </Button>
      <Button className="nb-add__pill" size="small" icon={TYPE_ICON.markdown} onClick={() => onAdd('markdown')}>
        + {t('add_markdown')}
      </Button>
      <Dropdown
        trigger={['click']}
        menu={{
          items: moreItems,
          onClick: ({ key }) => onAdd(key as CellType),
        }}
      >
        <Button className="nb-add__more" size="small" type="text" icon={<DownOutlined />}>
          {t('more_cell_types')}
        </Button>
      </Dropdown>
    </div>
  );
}
