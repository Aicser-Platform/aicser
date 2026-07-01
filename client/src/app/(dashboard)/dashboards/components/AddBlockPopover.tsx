'use client';

import React, { useMemo, useState } from 'react';
import { Popover, Input, Tabs, Button, Space } from 'antd';
import { SearchOutlined, AppstoreOutlined, FilterOutlined, LayoutOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { WidgetBlockPicker } from './WidgetBlockPicker';
import { FilterPresetPicker } from './FilterPresetPicker';
import { LayoutPresetPicker } from './LayoutPresetPicker';
import type { WidgetTemplate } from '../widgetTemplates';
import type { DashboardFilter } from '@/types/dashboard';
import type { LayoutPreset } from './LayoutPresetsMenu';

interface AddBlockPopoverProps {
  children: React.ReactNode;
  onSelect: (type: string) => void;
  onAddFilterPreset?: (filter: Partial<DashboardFilter>) => void;
  onApplyLayoutPreset?: (preset: LayoutPreset) => void;
  filtersPanelOpen?: boolean;
  onOpenFilterPanel?: () => void;
  onOpenFilterManager?: () => void;
}

export const AddBlockPopover: React.FC<AddBlockPopoverProps> = ({
  children,
  onSelect,
  onAddFilterPreset,
  onApplyLayoutPreset,
  filtersPanelOpen = false,
  onOpenFilterPanel,
  onOpenFilterManager,
}) => {
  const t = useTranslations('dashboards_page');
  const td = useTranslations('dashboards');
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('blocks');

  const closeAndReset = () => {
    setVisible(false);
    setSearch('');
    setTab('blocks');
  };

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
            onSelect={(template: WidgetTemplate) => {
              onSelect(template.type);
              closeAndReset();
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
              onAddFilterPreset?.(preset);
              closeAndReset();
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
              onApplyLayoutPreset?.(preset);
              closeAndReset();
            }}
          />
        ),
      },
    ],
    [onAddFilterPreset, onApplyLayoutPreset, onOpenFilterManager, onSelect, search, t],
  );

  const content = (
    <div className="flex flex-col w-[340px]">
      {tab === 'blocks' ? (
        <div className="px-2.5 py-2 border-b border-border-light">
          <Input
            prefix={<SearchOutlined className="text-text-tertiary" />}
            placeholder={t('search_block_type')}
            variant="borderless"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="!bg-transparent !rounded-md !px-2 !py-0.5"
            autoFocus
          />
        </div>
      ) : null}

      <div className="max-h-[460px] overflow-y-auto px-2 py-1.5 pb-2">
        <Tabs activeKey={tab} onChange={setTab} items={tabItems} size="small" />
      </div>
      {onOpenFilterPanel || onOpenFilterManager ? (
        <Space className="px-2.5 py-1.5 pb-2 border-t border-border-light">
          {onOpenFilterPanel ? (
            <Button
              type="link"
              size="small"
              onClick={() => {
                closeAndReset();
                onOpenFilterPanel();
              }}
            >
              {filtersPanelOpen ? td('hide_filters') : td('show_filters')}
            </Button>
          ) : null}
          {onOpenFilterManager ? (
            <Button
              type="link"
              size="small"
              onClick={() => {
                closeAndReset();
                onOpenFilterManager();
              }}
            >
              {t('add_drawer_manage_filters')}
            </Button>
          ) : null}
        </Space>
      ) : null}
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={visible}
      onOpenChange={(open) => {
        setVisible(open);
        if (!open) {
          setSearch('');
          setTab('blocks');
        }
      }}
      placement="bottomLeft"
      classNames={{
        root: '[&_.ant-popover-inner]:!p-0 [&_.ant-popover-inner]:!rounded-lg [&_.ant-popover-inner]:!overflow-hidden [&_.ant-popover-inner]:!shadow-md [&_.ant-popover-inner]:!border [&_.ant-popover-inner]:!border-border-light [&_.ant-popover-inner]:!bg-bg-container',
      }}
      arrow={false}
    >
      {children}
    </Popover>
  );
};
