'use client';

import React, { useMemo, useState } from 'react';
import { Drawer, Input, Tabs, Button, Space } from 'antd';
import { SearchOutlined, AppstoreOutlined, FilterOutlined, LayoutOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { WidgetBlockPicker } from './WidgetBlockPicker';
import { FilterPresetPicker } from './FilterPresetPicker';
import { LayoutPresetPicker } from './LayoutPresetPicker';
import type { WidgetTemplate } from '../widgetTemplates';
import type { DashboardFilter } from '@/types/dashboard';
import type { LayoutPreset } from './LayoutPresetsMenu';
import './AddDashboardDrawer.css';

export type AddDashboardDrawerProps = {
  open: boolean;
  onClose: () => void;
  onSelectBlock: (template: WidgetTemplate) => void;
  onAddFilterPreset: (filter: Partial<DashboardFilter>) => void;
  onApplyLayoutPreset: (preset: LayoutPreset) => void;
  onOpenFilterManager?: () => void;
};

export function AddDashboardDrawer({
  open,
  onClose,
  onSelectBlock,
  onAddFilterPreset,
  onApplyLayoutPreset,
  onOpenFilterManager,
}: AddDashboardDrawerProps) {
  const t = useTranslations('dashboards_page');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('blocks');

  const tabItems = useMemo(
    () => [
      {
        key: 'blocks',
        label: (
          <span>
            <AppstoreOutlined /> {t('add_drawer_blocks')}
          </span>
        ),
        children: (
          <WidgetBlockPicker
            variant="popover"
            search={search}
            onSelect={(template) => {
              onSelectBlock(template);
              onClose();
            }}
          />
        ),
      },
      {
        key: 'filters',
        label: (
          <span>
            <FilterOutlined /> {t('add_drawer_filters')}
          </span>
        ),
        children: (
          <FilterPresetPicker
            onSelect={(preset) => {
              onAddFilterPreset(preset);
              onClose();
            }}
            onAdvanced={onOpenFilterManager}
          />
        ),
      },
      {
        key: 'layouts',
        label: (
          <span>
            <LayoutOutlined /> {t('add_drawer_layouts')}
          </span>
        ),
        children: (
          <LayoutPresetPicker
            onSelect={(preset) => {
              onApplyLayoutPreset(preset);
              onClose();
            }}
          />
        ),
      },
    ],
    [onAddFilterPreset, onApplyLayoutPreset, onClose, onOpenFilterManager, onSelectBlock, t],
  );

  return (
    <Drawer
      title={t('add_drawer_title')}
      placement="left"
      width={360}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      {tab === 'blocks' ? (
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('search_block_type')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          className="!mb-3"
        />
      ) : null}
      <Tabs activeKey={tab} onChange={setTab} items={tabItems} size="small" />
      {onOpenFilterManager ? (
        <Space className="!mt-4 w-full !justify-center">
          <Button type="link" size="small" onClick={onOpenFilterManager}>
            {t('add_drawer_manage_filters')}
          </Button>
        </Space>
      ) : null}
    </Drawer>
  );
}

export default AddDashboardDrawer;
