'use client';

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Tooltip } from 'antd';
import { BgColorsOutlined, CopyOutlined, DeleteOutlined, DownOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { WidgetInstance } from '../stores/useDashboardStore';
import { buildDashboardChartTypeSwitcherOptions } from '../Properties/dashboardChartTypeSwitcher';
import { CHART_PALETTE_CATALOG, WIDGET_PALETTE_INHERIT, effectiveWidgetPalette } from '../utils/chartPaletteCatalog';
import { chartTypeChangePatch } from '../utils/chartTypeChange';

const NO_VISUAL_TYPES = new Set(['text', 'image', 'embed', 'divider', 'slicer', 'filter']);
/** Nearest ancestor that clips or scrolls vertically (the canvas), else null for the viewport. */
function clippingParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'hidden') return p;
  }
  return null;
}

const STORY_SLOT_KEYS = ['story_slot_kpi', 'story_slot_trend', 'story_slot_compare', 'story_slot_share', 'story_slot_detail'];

/**
 * Canva-style bar above the selected card: the edits people make most (chart type, colours,
 * duplicate, delete) without opening the side panel. Same rules as Properties.
 */
export function WidgetQuickBar({
  widget,
  onUpdate,
  onDuplicate,
  onDelete,
}: {
  widget: WidgetInstance;
  onUpdate: (patch: Partial<WidgetInstance>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('dashboards');
  const tPage = useTranslations('dashboards_page');
  // Sits above the card; on a top-row card there's no room there (it would slide under the
  // page tabs), so it flips below — as Canva and Figma do.
  const barRef = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const card = bar?.parentElement;
    if (!bar || !card) return;
    const scroller = clippingParent(card);
    const check = () => {
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      setBelow(card.getBoundingClientRect().top - (bar.offsetHeight + 24) < top);
    };
    check();
    const target: HTMLElement | Window = scroller || window;
    target.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      target.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  });
  const isVisual = !NO_VISUAL_TYPES.has(String(widget.chartType));

  const typeOptions = useMemo(
    () => buildDashboardChartTypeSwitcherOptions(widget.chartType, widget.chartQuery as never).filter((o) => !o.disabled),
    [widget.chartType, widget.chartQuery],
  );
  const current = typeOptions.find((o) => o.type === widget.chartType);

  const changeType = (nextType: string) => {
    if (nextType === widget.chartType) return;
    const placeholders = STORY_SLOT_KEYS.map((k) => tPage(k as never));
    onUpdate(chartTypeChangePatch(widget, nextType, tPage as never, placeholders));
  };

  const palette = effectiveWidgetPalette(widget.chartOptions as Record<string, unknown>) || WIDGET_PALETTE_INHERIT;
  const setPalette = (id: string) =>
    onUpdate({
      chartOptions: {
        ...(widget.chartOptions || {}),
        colorPalette: id,
        customPalette: undefined,
        customColor: undefined,
      } as WidgetInstance['chartOptions'],
    });

  const swatches = (colors: readonly string[]) => (
    <span className="widget-quickbar-swatches" aria-hidden>
      {colors.slice(0, 5).map((c) => (
        <i key={c} style={{ background: c }} />
      ))}
    </span>
  );

  return (
    <div
      ref={barRef}
      className={`widget-quickbar no-drag${below ? ' widget-quickbar--below' : ''}`}
      role="toolbar"
      aria-label={t('quickbar_label')}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isVisual && typeOptions.length > 1 ? (
        <Dropdown
          trigger={['click']}
          menu={{
            selectable: true,
            selectedKeys: [String(widget.chartType)],
            items: typeOptions.map((o) => ({ key: o.type, icon: o.icon, label: o.label })),
            onClick: ({ key }) => changeType(String(key)),
          }}
        >
          <Button type="text" size="small" aria-label={t('quickbar_chart_type')}>
            {current?.icon} <span className="widget-quickbar-text">{current?.label}</span> <DownOutlined />
          </Button>
        </Dropdown>
      ) : null}
      {isVisual ? (
        <Dropdown
          trigger={['click']}
          menu={{
            selectable: true,
            selectedKeys: [palette],
            items: [
              { key: WIDGET_PALETTE_INHERIT, label: t('palette_inherit_dashboard') },
              ...CHART_PALETTE_CATALOG.map((p) => ({
                key: p.id,
                label: (
                  <span className="widget-quickbar-palette">
                    {t(p.labelKey as never)} {swatches(p.colors)}
                  </span>
                ),
              })),
            ],
            onClick: ({ key }) => setPalette(String(key)),
          }}
        >
          <Tooltip title={t('quickbar_colors')}>
            <Button type="text" size="small" icon={<BgColorsOutlined />} aria-label={t('quickbar_colors')} />
          </Tooltip>
        </Dropdown>
      ) : null}
      <Tooltip title={t('quickbar_duplicate')}>
        <Button type="text" size="small" icon={<CopyOutlined />} onClick={onDuplicate} aria-label={t('quickbar_duplicate')} />
      </Tooltip>
      <Tooltip title={t('quickbar_delete')}>
        <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={onDelete} aria-label={t('quickbar_delete')} />
      </Tooltip>
    </div>
  );
}
