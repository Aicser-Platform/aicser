'use client';

import React from 'react';
import { Dropdown, Button } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { LayoutItem } from '../stores/useDashboardStore';

export type LayoutPreset = {
  id: string;
  nameKey: string;
  layout: Omit<LayoutItem, 'i'>[];
};

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'executive',
    nameKey: 'preset_executive',
    layout: [
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 3, y: 0, w: 3, h: 3 },
      { x: 6, y: 0, w: 3, h: 3 },
      { x: 9, y: 0, w: 3, h: 3 },
      { x: 0, y: 3, w: 6, h: 5 },
      { x: 6, y: 3, w: 6, h: 5 },
    ],
  },
  {
    id: 'kpi-row',
    nameKey: 'preset_kpi_row',
    layout: [
      { x: 0, y: 0, w: 4, h: 3 },
      { x: 4, y: 0, w: 4, h: 3 },
      { x: 8, y: 0, w: 4, h: 3 },
      { x: 0, y: 3, w: 12, h: 6 },
    ],
  },
  {
    id: 'two-col',
    nameKey: 'preset_two_col',
    layout: [
      { x: 0, y: 0, w: 6, h: 5 },
      { x: 6, y: 0, w: 6, h: 5 },
      { x: 0, y: 5, w: 6, h: 5 },
      { x: 6, y: 5, w: 6, h: 5 },
    ],
  },
  {
    id: 'analytics',
    nameKey: 'preset_analytics',
    layout: [
      { x: 0, y: 0, w: 3, h: 3 },
      { x: 3, y: 0, w: 3, h: 3 },
      { x: 6, y: 0, w: 6, h: 3 },
      { x: 0, y: 3, w: 8, h: 6 },
      { x: 8, y: 3, w: 4, h: 6 },
      { x: 0, y: 9, w: 4, h: 5 },
      { x: 4, y: 9, w: 4, h: 5 },
      { x: 8, y: 9, w: 4, h: 5 },
    ],
  },
  {
    id: 'report',
    nameKey: 'preset_report',
    layout: [
      { x: 0, y: 0, w: 12, h: 2 },
      { x: 0, y: 2, w: 4, h: 3 },
      { x: 4, y: 2, w: 4, h: 3 },
      { x: 8, y: 2, w: 4, h: 3 },
      { x: 0, y: 5, w: 12, h: 6 },
      { x: 0, y: 11, w: 6, h: 5 },
      { x: 6, y: 11, w: 6, h: 5 },
    ],
  },
  {
    id: 'ops-center',
    nameKey: 'preset_ops',
    layout: [
      { x: 0, y: 0, w: 2, h: 3 },
      { x: 2, y: 0, w: 2, h: 3 },
      { x: 4, y: 0, w: 2, h: 3 },
      { x: 6, y: 0, w: 6, h: 6 },
      { x: 0, y: 3, w: 6, h: 6 },
      { x: 0, y: 9, w: 3, h: 3 },
      { x: 3, y: 9, w: 3, h: 3 },
      { x: 6, y: 6, w: 6, h: 6 },
    ],
  },
  {
    id: 'full-table',
    nameKey: 'preset_full_table',
    layout: [{ x: 0, y: 0, w: 12, h: 10 }],
  },
];

type Props = {
  widgetCount: number;
  onApply: (preset: LayoutPreset) => void;
};

export function LayoutPresetsMenu({ widgetCount, onApply }: Props) {
  const t = useTranslations('dashboards');

  if (widgetCount === 0) return null;

  const items = LAYOUT_PRESETS.map((p) => ({
    key: p.id,
    label: t(p.nameKey as 'preset_executive'),
    onClick: () => onApply(p),
  }));

  return (
    <Dropdown menu={{ items }} trigger={['click']}>
      <Button icon={<AppstoreOutlined />} size="small">
        {t('layout_presets')}
      </Button>
    </Dropdown>
  );
}

export default LayoutPresetsMenu;
