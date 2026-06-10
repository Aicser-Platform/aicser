'use client';

import React from 'react';
import { Breadcrumb, Button } from 'antd';
import { useTranslations } from 'next-intl';
import type { WidgetDrillState } from '../utils/drillDownHelpers';

type Props = {
  drillPath: string[];
  drillState: WidgetDrillState;
  onNavigate: (level: number) => void;
  onClear: () => void;
};

export function DrillBreadcrumb({ drillPath, drillState, onNavigate, onClear }: Props) {
  const t = useTranslations('drill_down_navigation_ui');

  if (!drillPath.length || drillState.filters.length === 0) return null;

  const items = [
    {
      title: (
        <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => onNavigate(0)}>
          {drillPath[0]}
        </Button>
      ),
    },
    ...drillState.filters.map((filter, index) => ({
      title:
        index < drillState.filters.length - 1 ? (
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: 'auto' }}
            onClick={() => onNavigate(index + 1)}
          >
            {String(filter.value)}
          </Button>
        ) : (
          <span>{String(filter.value)}</span>
        ),
    })),
  ];

  return (
    <div
      className="widget-drill-breadcrumb no-drag"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        fontSize: 12,
        borderBottom: '1px solid var(--ant-color-border-secondary)',
        flexWrap: 'wrap',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span style={{ color: 'var(--ant-color-text-secondary)' }}>{t('drill_down_navigation')}:</span>
      <Breadcrumb items={items} separator="/" />
      <Button type="link" size="small" onClick={onClear}>
        {t('clear')}
      </Button>
    </div>
  );
}
