'use client';

/**
 * Everything that can go on a board, from the toolbar's Add: new blocks, charts already in the
 * library, filters and layouts. Click to add at the end, or drag onto the canvas to place it
 * exactly — while dragging, the popover fades so the drop spot shows. Properties keep the right.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Empty, Input, Popover, Spin, Tabs, Tooltip, Typography } from 'antd';
import { HolderOutlined, RobotOutlined, SearchOutlined } from '@ant-design/icons';
import { useProjectStore } from '@/stores/useProjectStore';
import { chartBuilderService } from '../../chart-designer/services/chartBuilderService';
import { getDashboardChartTypeIcon } from '../Properties/dashboardChartTypeSwitcher';
import { WidgetBlockPicker } from './WidgetBlockPicker';
import { FilterPresetPicker } from './FilterPresetPicker';
import { LayoutPresetPicker } from './LayoutPresetPicker';
import { endCanvasDrag, startCanvasDrag } from '../utils/canvasDrag';
import type { WidgetTemplate } from '../widgetTemplates';
import type { DashboardFilter } from '@/types/dashboard';
import type { LayoutPreset } from './LayoutPresetsMenu';
import type { WidgetInstance } from '../stores/dashboardStoreTypes';
import './AddPopover.css';

const { Text } = Typography;

export type LibraryChart = { chartId: string; title: string; chartType: string };

type Props = {
  widgets: WidgetInstance[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  onAddBlock: (template: WidgetTemplate) => void;
  onAddChart: (chart: LibraryChart) => void;
  onAddFilterPreset: (filter: Partial<DashboardFilter>) => void;
  onOpenFilterManager: () => void;
  onApplyLayoutPreset: (preset: LayoutPreset) => void;
  /** Build widgets by describing them (the AI builder in the left rail). */
  onOpenAi: () => void;
};

function SavedCharts({ widgets, onAdd }: { widgets: WidgetInstance[]; onAdd: (c: LibraryChart) => void }) {
  const t = useTranslations('dashboards_page');
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [charts, setCharts] = useState<LibraryChart[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    chartBuilderService
      .listCharts(projectId, { detail: 'summary', limit: 200 })
      .then((rows) => {
        if (!alive) return;
        setCharts(rows.map((c) => ({
          chartId: String(c.id),
          title: String(c.name || c.title || t('add_panel_untitled')),
          chartType: String(c.type || c.chartType || c.chart_type || 'bar'),
        })));
      })
      .catch(() => alive && setCharts([]));
    return () => {
      alive = false;
    };
  }, [projectId, t]);

  const onBoard = useMemo(() => new Set(widgets.map((w) => String(w.chartId ?? ''))), [widgets]);
  const shown = (charts ?? []).filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase()));

  if (charts === null) return <Spin size="small" />;
  if (!charts.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('add_panel_no_charts')} />;
  return (
    <div className="add-panel__charts">
      <div className="add-panel__search-sticky">
        <Input size="small" allowClear prefix={<SearchOutlined />} placeholder={t('add_panel_search_charts')}
          value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('add_panel_search_charts')} />
      </div>
      <div className="add-panel__content-scroll">
        <ul className="add-panel__chart-list">
          {shown.map((c) => {
            const already = onBoard.has(c.chartId);
            return (
              <li key={c.chartId}>
                <Tooltip title={already ? t('add_panel_on_board') : t('add_panel_chart_hint')} placement="left" mouseEnterDelay={0.4}>
                  <button
                    type="button"
                    className="add-panel__chart"
                    disabled={already}
                    draggable={!already}
                    onDragStart={(e) => startCanvasDrag(e, { kind: 'chart', chartId: c.chartId, title: c.title, chartType: c.chartType, w: 6, h: 5 })}
                    onDragEnd={endCanvasDrag}
                    onClick={() => onAdd(c)}
                  >
                    <HolderOutlined className="add-panel__grip" aria-hidden />
                    <span className="add-panel__chart-icon" aria-hidden>{getDashboardChartTypeIcon(c.chartType)}</span>
                    <span className="add-panel__chart-title">{c.title}</span>
                  </button>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function AddPopover({
  widgets, open, onOpenChange, children, onAddBlock, onAddChart, onAddFilterPreset, onOpenFilterManager, onApplyLayoutPreset, onOpenAi,
}: Props) {
  const t = useTranslations('dashboards_page');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('blocks');
  const [dragging, setDragging] = useState(false);

  // A drag from the popover: fade it (not close it, which would end the drag) and close on drop.
  useEffect(() => {
    if (!open) return;
    const start = () => setDragging(true);
    const end = () => {
      setDragging((was) => {
        if (was) onOpenChange(false);
        return false;
      });
    };
    window.addEventListener('dragstart', start);
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      window.removeEventListener('dragstart', start);
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
    };
  }, [open, onOpenChange]);

  const done = <A,>(fn: (a: A) => void) => (a: A) => {
    fn(a);
    onOpenChange(false);
  };

  const content = (
    <div className="add-popover">
      <Text type="secondary" className="add-panel__hint">{t('add_panel_hint')}</Text>
      <Tabs
        size="small"
        tabBarGutter={12}
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'blocks',
            label: t('add_drawer_blocks'),
            children: (
              <div className="add-panel__body">
                <div className="add-panel__search-sticky">
                  <Input size="small" allowClear autoFocus prefix={<SearchOutlined />} placeholder={t('search_block_type')}
                    value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('search_block_type')} />
                </div>
                <div className="add-panel__content-scroll">
                  <WidgetBlockPicker variant="popover" draggable search={search} onSelect={done(onAddBlock)} />
                </div>
              </div>
            ),
          },
          { key: 'charts', label: t('add_panel_saved_charts'), children: <SavedCharts widgets={widgets} onAdd={done(onAddChart)} /> },
          {
            key: 'filters',
            label: t('add_drawer_filters'),
            children: (
              <div className="add-panel__body">
                <div className="add-panel__content-scroll">
                  <FilterPresetPicker onSelect={done(onAddFilterPreset)} onAdvanced={() => { onOpenChange(false); onOpenFilterManager(); }} />
                </div>
              </div>
            ),
          },
          {
            key: 'layouts',
            label: t('add_drawer_layouts'),
            children: (
              <div className="add-panel__body">
                <div className="add-panel__content-scroll">
                  <LayoutPresetPicker widgets={widgets} onSelect={done(onApplyLayoutPreset)} />
                </div>
              </div>
            ),
          },
        ]}
      />
      <div className="add-popover__footer">
        <Button block size="small" icon={<RobotOutlined />} onClick={() => { onOpenChange(false); onOpenAi(); }}>{t('add_panel_ai')}</Button>
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={(next) => { if (!dragging) onOpenChange(next); }}
      placement="bottomRight"
      arrow={false}
      classNames={{ root: `add-popover-root${dragging ? ' add-popover-root--dragging' : ''}` }}
    >
      {children}
    </Popover>
  );
}

export default AddPopover;
