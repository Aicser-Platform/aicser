'use client';

import React, { useMemo, useState } from 'react';
import { Popover, Input, Tabs, Button, Space } from 'antd';
import {
  SearchOutlined,
  AppstoreOutlined,
  FilterOutlined,
  LayoutOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { getChatHref } from '@/utils/appPaths';
import { useTranslations } from 'next-intl';
import { WidgetBlockPicker } from './WidgetBlockPicker';
import { FilterPresetPicker } from './FilterPresetPicker';
import { LayoutPresetPicker } from './LayoutPresetPicker';
import type { WidgetTemplate } from '../widgetTemplates';
import type { DashboardFilter } from '@/types/dashboard';
import type { LayoutPreset } from './LayoutPresetsMenu';
import type { WidgetInstance } from '../stores/dashboardStoreTypes';

interface AddBlockPopoverProps {
  children: React.ReactNode;
  onSelect: (type: string) => void;
  onAddFilterPreset?: (filter: Partial<DashboardFilter>) => void;
  onApplyLayoutPreset?: (preset: LayoutPreset) => void;
  filtersPanelOpen?: boolean;
  onOpenFilterPanel?: () => void;
  onOpenFilterManager?: () => void;
  /** Current dashboard widgets — used to auto-recommend the best-fitting layout preset. */
  widgets?: WidgetInstance[];
}

export const AddBlockPopover: React.FC<AddBlockPopoverProps> = ({
  children,
  onSelect,
  onAddFilterPreset,
  onApplyLayoutPreset,
  filtersPanelOpen = false,
  onOpenFilterPanel,
  onOpenFilterManager,
  widgets = [],
}) => {
  const t = useTranslations('dashboards_page');
  const td = useTranslations('dashboards');
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('blocks');
  const [aiPrompt, setAiPrompt] = useState('');

  const closeAndReset = () => {
    setVisible(false);
    setSearch('');
    setTab('blocks');
    setAiPrompt('');
  };

  const handleAiGenerate = () => {
    const p = aiPrompt.trim().toLowerCase();
    if (!p) return;
    if (p.includes('kpi') || p.includes('metric') || p.includes('stat')) {
      onSelect('stat');
    } else if (p.includes('trend') || p.includes('line') || p.includes('time')) {
      onSelect('line');
    } else if (p.includes('pie') || p.includes('share')) {
      onSelect('pie');
    } else if (p.includes('donut')) {
      onSelect('donut');
    } else if (p.includes('divider') || p.includes('section') || p.includes('group')) {
      onSelect('divider');
    } else if (p.includes('table') || p.includes('list')) {
      onSelect('table');
    } else {
      onSelect('bar');
    }
    closeAndReset();
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
            widgets={widgets}
            onSelect={(preset) => {
              onApplyLayoutPreset?.(preset);
              closeAndReset();
            }}
          />
        ),
      },
      {
        key: 'ai',
        label: (
          <span>
            <RobotOutlined /> {t('add_drawer_ai')}
          </span>
        ),
        children: (
          <div className="flex flex-col gap-2.5 p-2 text-left">
            <div className="text-xs text-text-secondary leading-snug">
              {td('ai_assistant_desc')}
            </div>
            <Input.TextArea
              rows={2}
              placeholder={td('ai_assistant_prompt_placeholder')}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              className="!text-xs !rounded-md"
              onPressEnter={(e) => {
                if (e.shiftKey) return;
                e.preventDefault();
                handleAiGenerate();
              }}
            />
            <div className="flex items-center gap-1.5 justify-between">
              <Button
                type="primary"
                size="small"
                icon={<SendOutlined />}
                disabled={!aiPrompt.trim()}
                onClick={handleAiGenerate}
                className="flex-1"
              >
                {td('ai_assistant_create_chart')}
              </Button>
              <Link href={getChatHref({ mode: 'dashboard' })}>
                <Button size="small" type="default" icon={<RobotOutlined />}>
                  Chat
                </Button>
              </Link>
            </div>
            <div className="border-t border-border-light pt-2 mt-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">
                {td('ai_assistant_quick_actions')}
              </div>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  className="text-left text-xs py-1 px-1.5 rounded hover:bg-brand-subtle hover:text-brand transition-colors text-text-secondary"
                  onClick={() => {
                    onSelect('divider');
                    closeAndReset();
                  }}
                >
                  📑 {td('ai_action_section')} (Group charts)
                </button>
                <button
                  type="button"
                  className="text-left text-xs py-1 px-1.5 rounded hover:bg-brand-subtle hover:text-brand transition-colors text-text-secondary"
                  onClick={() => {
                    onSelect('stat');
                    closeAndReset();
                  }}
                >
                  🎯 {td('ai_action_kpi')}
                </button>
                <button
                  type="button"
                  className="text-left text-xs py-1 px-1.5 rounded hover:bg-brand-subtle hover:text-brand transition-colors text-text-secondary"
                  onClick={() => {
                    onSelect('line');
                    closeAndReset();
                  }}
                >
                  📈 {td('ai_action_trend')}
                </button>
                <button
                  type="button"
                  className="text-left text-xs py-1 px-1.5 rounded hover:bg-brand-subtle hover:text-brand transition-colors text-text-secondary"
                  onClick={() => {
                    onSelect('bar');
                    closeAndReset();
                  }}
                >
                  📊 {td('ai_action_group')}
                </button>
              </div>
            </div>
          </div>
        ),
      },
    ],
    [aiPrompt, onAddFilterPreset, onApplyLayoutPreset, onOpenFilterManager, onSelect, search, t, td, widgets],
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
        root: '[&_.ant-popover-inner]:!p-0 [&_.ant-popover-inner]:!rounded-lg [&_.ant-popover-inner]:!overflow-hidden [&_.ant-popover-inner]:!shadow-md [&_.ant-popover-inner]:!border [&_.ant-popover-inner]:!border-border-light [&_.ant-popover-inner]:!bg-bg-elevated',
      }}
      arrow={false}
    >
      {children}
    </Popover>
  );
};
