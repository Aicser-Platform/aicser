'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button, Input, Tag, Typography, message } from 'antd';
import {
  RobotOutlined,
  SendOutlined,
  PlusOutlined,
  BarChartOutlined,
  BorderHorizontalOutlined,
  FundOutlined,
  FileAddOutlined,
  ArrowRightOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { getChatHref } from '@/utils/appPaths';
import { useDashboardStore } from '../../../stores/useDashboardStore';
import { findWidgetTemplate, generateWidgetId } from '../../../utils/buildDashboardWidget';
import { maxLayoutY } from '../../../utils/layoutSanitize';
import type { LayoutItem, WidgetInstance, WidgetType } from '../../../stores/dashboardStoreTypes';

const { Text } = Typography;

interface AiChatSectionProps {
  activeDashboardId?: string | null;
  activeDashboardName?: string;
  widgetCount?: number;
  onAddDivider?: () => void;
  onAddKpi?: () => void;
  onAddNewPage?: () => void;
  onOpenChartImport?: () => void;
}

export function AiChatSection({
  activeDashboardId,
  activeDashboardName,
  widgetCount = 0,
  onAddDivider,
  onAddKpi,
  onAddNewPage,
  onOpenChartImport,
}: AiChatSectionProps) {
  const t = useTranslations('dashboards');
  const [prompt, setPrompt] = useState('');
  const layout = useDashboardStore((s) => s.layout);
  const addWidget = useDashboardStore((s) => s.addWidget);

  const handleQuickAdd = (type: WidgetType, customTitle?: string) => {
    const template = findWidgetTemplate(type);
    if (!template) return;

    const instanceId = generateWidgetId();
    const widget: WidgetInstance = {
      id: instanceId,
      dataSourceId: undefined,
      chartType: type,
      title: customTitle || (type === 'divider' ? 'Section Overview' : template.name),
      chartOptions:
        type === 'divider'
          ? { sectionTitle: customTitle || 'Section Overview', uppercase: true }
          : type === 'stat'
          ? { format: 'number', fontSize: 32, layout: 'default', showSparkline: false }
          : { showLegend: true, showDataLabel: false, showGridline: true, showAxis: true },
      ...(type === 'stat' ? { chartQuery: { yMetric: 'count', yMetrics: [], sortBy: 'x' } } : {}),
    };

    const layoutItem: LayoutItem = {
      i: instanceId,
      x: 0,
      y: maxLayoutY(layout),
      w: template.defaultSize.w,
      h: template.defaultSize.h,
    };

    addWidget(widget, layoutItem);
    message.success(t('ai_assistant_title') + ': ' + (customTitle || template.name));
  };

  const handleSmartPromptSubmit = () => {
    const p = prompt.trim().toLowerCase();
    if (!p) return;

    // Smart heuristic chart creator based on natural language prompt
    if (p.includes('kpi') || p.includes('metric') || p.includes('stat') || p.includes('number')) {
      handleQuickAdd('stat', prompt.trim());
    } else if (p.includes('trend') || p.includes('line') || p.includes('time') || p.includes('daily') || p.includes('monthly')) {
      handleQuickAdd('line', prompt.trim());
    } else if (p.includes('pie') || p.includes('share') || p.includes('proportion')) {
      handleQuickAdd('pie', prompt.trim());
    } else if (p.includes('donut')) {
      handleQuickAdd('donut', prompt.trim());
    } else if (p.includes('divider') || p.includes('section') || p.includes('group')) {
      handleQuickAdd('divider', prompt.trim());
    } else if (p.includes('table') || p.includes('list') || p.includes('raw')) {
      handleQuickAdd('table', prompt.trim());
    } else {
      handleQuickAdd('bar', prompt.trim());
    }

    setPrompt('');
  };

  const chatStudioUrl = activeDashboardId
    ? getChatHref({ mode: 'dashboard', dashboardId: activeDashboardId })
    : getChatHref({ mode: 'dashboard' });

  return (
    <div className="flex flex-col gap-3 p-3 text-left">
      {/* Context banner */}
      <div className="rounded-lg border border-border-light bg-bg-container p-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
          <RobotOutlined className="text-brand text-sm" />
          <span>{activeDashboardName || 'Active Dashboard'}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-tertiary">
          <span>{widgetCount} charts & blocks</span>
          <span>•</span>
          <Tag className="!m-0 !px-1.5 !text-[10px] !border-none !bg-brand-subtle !text-brand">AI Ready</Tag>
        </div>
      </div>

      {/* Prompt input */}
      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-text-secondary leading-snug">
          {t('ai_assistant_desc')}
        </div>
        <Input.TextArea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('ai_assistant_prompt_placeholder')}
          className="!text-xs !rounded-lg"
          onPressEnter={(e) => {
            if (e.shiftKey) return;
            e.preventDefault();
            handleSmartPromptSubmit();
          }}
        />
        <div className="flex items-center gap-1.5 justify-between mt-1">
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            disabled={!prompt.trim()}
            onClick={handleSmartPromptSubmit}
            className="flex-1"
          >
            {t('ai_assistant_create_chart')}
          </Button>
          <Link
            href={
              prompt.trim()
                ? `${chatStudioUrl}&q=${encodeURIComponent(prompt.trim())}`
                : chatStudioUrl
            }
          >
            <Button size="small" type="default" icon={<RobotOutlined />}>
              Chat
            </Button>
          </Link>
        </div>
      </div>

      {/* Quick suggestions to view & group charts */}
      <div className="border-t border-border-light pt-2.5 flex flex-col gap-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
          {t('ai_assistant_quick_actions')}
        </div>
        <div className="flex flex-col gap-1">
          <Button
            type="text"
            size="small"
            icon={<BorderHorizontalOutlined className="text-brand" />}
            className="!flex !items-center !justify-start !text-xs !h-7 !px-2 text-text"
            onClick={() => (onAddDivider ? onAddDivider() : handleQuickAdd('divider', 'Section Divider'))}
          >
            <span className="truncate">{t('ai_action_section')}</span>
            <span className="ml-auto text-[10px] text-text-tertiary">Group</span>
          </Button>

          <Button
            type="text"
            size="small"
            icon={<FundOutlined className="text-emerald-500" />}
            className="!flex !items-center !justify-start !text-xs !h-7 !px-2 text-text"
            onClick={() => (onAddKpi ? onAddKpi() : handleQuickAdd('stat', 'Headline Metric'))}
          >
            <span className="truncate">{t('ai_action_kpi')}</span>
            <span className="ml-auto text-[10px] text-text-tertiary">KPI</span>
          </Button>

          <Button
            type="text"
            size="small"
            icon={<BarChartOutlined className="text-blue-500" />}
            className="!flex !items-center !justify-start !text-xs !h-7 !px-2 text-text"
            onClick={() => handleQuickAdd('bar', 'Category Breakdown')}
          >
            <span className="truncate">{t('ai_action_group')}</span>
            <span className="ml-auto text-[10px] text-text-tertiary">Bar</span>
          </Button>

          {onAddNewPage && (
            <Button
              type="text"
              size="small"
              icon={<FileAddOutlined className="text-purple-500" />}
              className="!flex !items-center !justify-start !text-xs !h-7 !px-2 text-text"
              onClick={onAddNewPage}
            >
              <span className="truncate">{t('ai_action_new_page')}</span>
              <span className="ml-auto text-[10px] text-text-tertiary">Tab</span>
            </Button>
          )}
        </div>
      </div>

      {/* Import & Deep Chat Links */}
      <div className="border-t border-border-light pt-2.5 flex flex-col gap-2">
        <Text type="secondary" className="!text-[11px] leading-relaxed">
          {t('ai_assistant_import_hint')}
        </Text>
        <Link href={chatStudioUrl} className="block w-full">
          <Button
            type="default"
            block
            size="small"
            icon={<RobotOutlined className="text-brand" />}
            className="!flex !items-center !justify-center !gap-1.5 !font-medium"
          >
            <span>{t('ai_assistant_open_chat')}</span>
            <ArrowRightOutlined className="text-[10px]" />
          </Button>
        </Link>
        {onOpenChartImport && (
          <Button
            type="dashed"
            block
            size="small"
            icon={<ImportOutlined />}
            onClick={onOpenChartImport}
            className="!text-xs"
          >
            {t('chart_import_title')}
          </Button>
        )}
      </div>
    </div>
  );
}

export default AiChatSection;
