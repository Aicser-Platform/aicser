'use client';

import React from 'react';
import { Button } from 'antd';
import {
  CalendarOutlined,
  FieldStringOutlined,
  NumberOutlined,
  SearchOutlined,
  CheckSquareOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { DashboardFilter } from '@/types/dashboard';

type PresetDef = {
  key: string;
  icon: React.ReactNode;
  labelKey: string;
  build: () => Partial<DashboardFilter>;
};

type Props = {
  onSelect: (filter: Partial<DashboardFilter>) => void;
  onAdvanced?: () => void;
};

export function FilterPresetPicker({ onSelect, onAdvanced }: Props) {
  const t = useTranslations('dashboards_page');

  const presets: PresetDef[] = [
    {
      key: 'date_range',
      icon: <CalendarOutlined />,
      labelKey: 'filter_preset_date_range',
      build: () => ({
        type: 'dateRange',
        name: t('filter_preset_date_range'),
        field: '',
        displayWidth: 'lg',
      }),
    },
    {
      key: 'single_date',
      icon: <CalendarOutlined />,
      labelKey: 'filter_preset_single_date',
      build: () => ({ type: 'date', name: t('filter_preset_single_date'), field: '' }),
    },
    {
      key: 'category',
      icon: <FieldStringOutlined />,
      labelKey: 'filter_preset_category',
      build: () => ({ type: 'dropdown', name: t('filter_preset_category'), field: '' }),
    },
    {
      key: 'multi',
      icon: <CheckSquareOutlined />,
      labelKey: 'filter_preset_multi',
      build: () => ({ type: 'checkbox', name: t('filter_preset_multi'), field: '' }),
    },
    {
      key: 'numeric',
      icon: <NumberOutlined />,
      labelKey: 'filter_preset_numeric',
      build: () => ({ type: 'slider', name: t('filter_preset_numeric'), field: '', numericMin: 0, numericMax: 100 }),
    },
    {
      key: 'search',
      icon: <SearchOutlined />,
      labelKey: 'filter_preset_search',
      build: () => ({ type: 'search', name: t('filter_preset_search'), field: '', displayWidth: 'md' }),
    },
  ];

  return (
    <div>
      <p className="text-xs text-text-secondary mb-3">{t('filter_preset_hint')}</p>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className="flex flex-col items-start gap-1.5 px-3 py-2.5 rounded-md border border-border-light bg-bg-container text-xs font-medium text-left transition-colors hover:border-brand hover:bg-brand-subtle"
            onClick={() => onSelect(p.build())}
          >
            <span className="text-base text-brand">{p.icon}</span>
            <span>{t(p.labelKey as 'filter_preset_date_range')}</span>
          </button>
        ))}
      </div>
      {onAdvanced ? (
        <Button type="link" block onClick={onAdvanced} className="!mt-3">
          {t('add_drawer_manage_filters')}
        </Button>
      ) : null}
    </div>
  );
}

export default FilterPresetPicker;
