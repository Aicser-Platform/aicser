'use client';

import React from 'react';
import { Button, Empty } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { WidgetPreview } from '../widgets/WidgetPreview';
import { WidgetInteractionHint } from './WidgetInteractionHint';
import { DrillBreadcrumb } from './DrillBreadcrumb';
import { createCrossFilterChartReady } from '../utils/crossFilterChart';
import {
  getDrillPath,
  getEffectiveDrillX,
  getInteractionMode,
} from '../utils/drillDownHelpers';
import { hasDrillThrough } from '../utils/drillThroughHelpers';
import { getFriendlyWidgetError } from '../utils/widgetErrorDisplay';
import type { RuntimeFilter } from '../utils/filterOperators';
import type { WidgetInstance } from '../stores/useDashboardStore';
import { useDashboardStore } from '../stores/useDashboardStore';

type Props = {
  widget: WidgetInstance;
  dashboardId?: string;
  runtimeFilters: RuntimeFilter[];
  readOnly?: boolean;
  isSelected?: boolean;
  isDesigner?: boolean;
  onCrossFilter?: (field: string, value: unknown) => void;
  onWidgetChartClick?: (
    widget: WidgetInstance,
    field: string,
    value: unknown,
    shiftKey: boolean,
  ) => void;
  onUpdateConfig?: (updates: Record<string, unknown>) => void;
  /** When set, failed widgets show a retry button instead of the default error state. */
  onRetryWidget?: (widgetId: string) => void;
};

/**
 * Shared widget body: interaction hint, drill breadcrumb, and WidgetPreview (palette-aware).
 * Used by edit canvas and read-only viewer grid so both paths stay in sync.
 */
export function DashboardWidgetCell({
  widget,
  dashboardId,
  runtimeFilters,
  readOnly = false,
  isSelected = false,
  isDesigner = false,
  onCrossFilter,
  onWidgetChartClick,
  onUpdateConfig,
  onRetryWidget,
}: Props) {
  const t = useTranslations('dashboard_viewer');
  const widgetDrillState = useDashboardStore((s) => s.widgetDrillState);
  const drillInto = useDashboardStore((s) => s.drillInto);
  const drillUp = useDashboardStore((s) => s.drillUp);
  const clearDrill = useDashboardStore((s) => s.clearDrill);

  const drillPath = getDrillPath(widget);
  const drillState = widgetDrillState[widget.id];
  const effectiveX = getEffectiveDrillX(widget, drillState);
  const interactionMode = getInteractionMode(widget);
  const drillThroughActive = hasDrillThrough(widget);
  const chartInteractionMode = drillThroughActive ? 'drill' : interactionMode;
  const friendlyError = getFriendlyWidgetError(widget.error);

  const chartReady =
    onCrossFilter || onWidgetChartClick || chartInteractionMode === 'drill'
      ? createCrossFilterChartReady(effectiveX, onCrossFilter, runtimeFilters, {
          chartType: widget.chartType,
          legendField: widget.chartQuery?.legend,
          interactionMode: chartInteractionMode,
          onDrill: (field, value) => {
            if (onWidgetChartClick) {
              onWidgetChartClick(widget, field, value, false);
            } else {
              void drillInto(widget.id, field, value);
            }
          },
        })
      : undefined;

  return (
    <>
      <WidgetInteractionHint widget={widget} />
      {drillPath.length > 0 && drillState ? (
        <DrillBreadcrumb
          drillPath={drillPath}
          drillState={drillState}
          onNavigate={(level) => void drillUp(widget.id, level)}
          onClear={() => void clearDrill(widget.id)}
        />
      ) : null}
      {widget.error && onRetryWidget ? (
        <div className="widget-center widget-error-retry" title={friendlyError.technicalDetail}>
          <Empty
            description={
              <span>
                <strong>{friendlyError.title}</strong>
                <br />
                {friendlyError.detail}
              </span>
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => onRetryWidget(widget.id)}
            >
              {t('retry')}
            </Button>
          </Empty>
        </div>
      ) : (
        <WidgetPreview
          widget={widget}
          dashboardId={dashboardId}
          runtimeFilters={runtimeFilters}
          readOnly={readOnly}
          onFilter={onCrossFilter}
          onChartReady={chartReady}
          onUpdateConfig={onUpdateConfig}
          isDesigner={isDesigner}
          isSelected={isSelected}
        />
      )}
    </>
  );
}

export default DashboardWidgetCell;
