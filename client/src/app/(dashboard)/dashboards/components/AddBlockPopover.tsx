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
import './AddBlockPopover.css';

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
    <div className="add-block-popover-content">
      {tab === 'blocks' ? (
        <div className="popover-search">
          <Input
            prefix={<SearchOutlined style={{ color: 'var(--studio-text-muted)' }} />}
            placeholder={t('search_block_type')}
            variant="borderless"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
            autoFocus
          />
        </div>
      ) : null}

      <div className="popover-scroll-area">
        <Tabs activeKey={tab} onChange={setTab} items={tabItems} size="small" />
      </div>
      {onOpenFilterPanel || onOpenFilterManager ? (
        <Space className="add-block-popover-footer">
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
      classNames={{ root: 'add-block-popover-overlay' }}
      arrow={false}
    >
      {children}
    </Popover>
  );
};
