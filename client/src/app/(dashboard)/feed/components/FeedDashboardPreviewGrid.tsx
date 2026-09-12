'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { WidgetPreview } from '@/app/(dashboard)/dashboards/widgets/WidgetPreview';
import { shouldShowWidgetHeader } from '@/app/(dashboard)/dashboards/utils/widgetCardHelpers';
import type { WidgetInstance } from '@/app/(dashboard)/dashboards/stores/useDashboardStore';
import '@/app/(dashboard)/dashboards/DashboardStudio.css';
import './feed-dashboard-preview.css';
import {
  FEED_DASHBOARD_PREVIEW_MAX,
  feedDashboardPreviewRecipe,
  feedPreviewKind,
  pickFeedPreviewWidgets,
} from '../utils/feedDashboardPreviewLayout';

function PreviewTile({
  widget,
  height,
  isHero,
  fill,
}: {
  widget: WidgetInstance;
  height: number;
  isHero: boolean;
  fill: boolean;
}) {
  const showHeader = shouldShowWidgetHeader(widget);
  const kind = feedPreviewKind(widget.chartType);

  return (
    <div
      className={`feed-dash-preview-tile widget-card widget-type-${widget.chartType} ${
        !showHeader ? 'header-hidden' : ''
      } ${isHero ? 'is-hero' : ''}`}
      style={fill ? undefined : { height }}
    >
      {showHeader && (
        <div className="widget-card-header widget-card-header-stack">
          <span className="widget-card-title">{widget.title}</span>
          {typeof widget.chartOptions?.subtitle === 'string' && widget.chartOptions.subtitle.trim() ? (
            <span className="widget-card-subtitle">{widget.chartOptions.subtitle}</span>
          ) : null}
        </div>
      )}
      <div className={`widget-card-body no-drag ${kind === 'text' ? 'overflow-y-auto' : ''}`}>
        <WidgetPreview
          widget={widget}
          readOnly
          compactPreview
          minHeight={fill ? undefined : Math.max(96, height - (showHeader ? 36 : 0))}
        />
      </div>
    </div>
  );
}

type Props = {
  widgets: WidgetInstance[];
  maxWidgets?: number;
  totalWidgetCount?: number;
};

/** Compact click-to-explore tease: 1 full-width visual in a narrow grid card; 1–4 tiles when wide. */
export function FeedDashboardPreviewGrid({
  widgets,
  maxWidgets = FEED_DASHBOARD_PREVIEW_MAX,
  totalWidgetCount,
}: Props) {
  const t = useTranslations('feed');
  const capped = pickFeedPreviewWidgets(widgets, maxWidgets);
  const recipe = feedDashboardPreviewRecipe(capped.map((w) => feedPreviewKind(w.chartType)));
  const total = totalWidgetCount ?? widgets.length;
  const overflow = Math.max(0, total - capped.length);

  if (!capped.length) return null;

  const isSingle = capped.length === 1;

  return (
    <div className="feed-dash-preview relative overflow-hidden bg-[var(--ant-color-bg-container)]">
      <div
        className={`feed-dash-preview-grid ${isSingle ? 'is-single' : 'is-multi'} ${
          recipe.chartOnly ? 'is-chart-only' : ''
        }`}
      >
        {capped.map((widget, index) => (
          <PreviewTile
            key={widget.id}
            widget={widget}
            height={recipe.heights[index] ?? 160}
            isHero={recipe.spans[index] === 'col-span-2'}
            fill={isSingle}
          />
        ))}
      </div>
      {overflow > 0 ? (
        <span
          className="pointer-events-none absolute bottom-2 right-2 z-10 rounded-full bg-[var(--ant-color-bg-elevated)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ant-color-text-secondary)] shadow-sm"
          aria-label={t('preview_more_aria', { count: overflow })}
        >
          {t('preview_more', { count: overflow })}
        </span>
      ) : null}
    </div>
  );
}

export default FeedDashboardPreviewGrid;
