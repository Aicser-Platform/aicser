'use client';

import React from 'react';
import { Alert, Button, Empty, Tooltip } from 'antd';
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { ErrorDetailsButton } from '@/components/ui/ErrorDetailsButton';
import { WidgetPreview } from '../widgets/WidgetPreview';
import { WidgetInteractionHint } from './WidgetInteractionHint';
import { WidgetFilterWarningHint } from './WidgetFilterWarningHint';
import { DrillBreadcrumb } from './DrillBreadcrumb';
import { createCrossFilterChartReady } from '../utils/crossFilterChart';
import {
  getDrillPath,
  getEffectiveDrillX,
  getInteractionMode,
} from '../utils/drillDownHelpers';
import { hasDrillThrough } from '../utils/drillThroughHelpers';
import { getFriendlyWidgetError } from '../utils/widgetErrorDisplay';
import { isEmptyDataWidget } from '../utils/bindEmptyWidgets';
import { hasRenderableChartData } from '@/components/charts/chartDesignerBridge';
import { inferFilterLabel } from '../utils/filterInference';
import { isDateRuntimeFilter, type RuntimeFilter } from '../utils/filterOperators';
import type { WidgetInstance } from '../stores/useDashboardStore';
import { useDashboardStore } from '../stores/useDashboardStore';

/** Whether a result has at least one row. Series with empty value arrays (a table or chart
 * whose query matched nothing) don't count, unlike a mere "has a data shape" check. */
function hasRows(data: unknown): boolean {
  if (data == null || typeof data !== 'object') return data != null;
  if (Array.isArray(data)) return data.length > 0;
  const d = data as Record<string, unknown>;
  const nonEmpty = (v: unknown) => Array.isArray(v) && v.length > 0;
  if (nonEmpty(d.x) || nonEmpty(d.y) || nonEmpty(d.rows) || nonEmpty(d.data)) return true;
  if (Array.isArray(d.series) && d.series.some((s) => nonEmpty((s as { data?: unknown })?.data))) return true;
  return d.value !== undefined && d.value !== null;
}

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
  /** Suppresses the "click to drill down / shift+click to cross-filter" hint icon.
   * Interactions themselves stay functional — this only hides the chrome, for
   * read-only consumption contexts (e.g. the feed) where it reads as clutter
   * rather than useful affordance. */
  hideInteractionHint?: boolean;
  /** Clears the dashboard's date filters; offered when they leave this widget with no rows. */
  onClearDateFilters?: () => void;
  /** False while editing: a click selects the card and never filters or drills (view mode does). */
  interactive?: boolean;
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
  hideInteractionHint = false,
  onClearDateFilters,
  interactive = true,
}: Props) {
  const t = useTranslations('dashboard_viewer');
  // Connected to a table but nothing picked to show (no category, no measure): say so rather than
  // drawing an empty table with a lone header. KPIs are exempt — a bare count is a real answer.
  const q = (widget.chartQuery || {}) as Record<string, unknown>;
  const noFieldsChosen =
    !isEmptyDataWidget(widget) &&
    Boolean(q.tableName) &&
    !q.saved_query_id &&
    !q.query_snapshot_id &&
    !q.compiled_semantic_sql &&
    !widget.chartOptions?.sample_sql &&
    !['stat', 'gauge', 'text', 'image', 'embed', 'divider', 'slicer', 'filter'].includes(String(widget.chartType)) &&
    !q.x &&
    !(Array.isArray(q.yMetrics) && q.yMetrics.length > 0) &&
    !(Array.isArray(q.xMetrics) && q.xMetrics.length > 0);
  const emptyUnderDates =
    widget.chartData !== undefined &&
    !widget.isLoading &&
    !widget.error &&
    !isEmptyDataWidget(widget) &&
    !hasRows(widget.chartData) &&
    runtimeFilters.some(isDateRuntimeFilter);
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
  const friendlyError = getFriendlyWidgetError(widget.error, t);
  // A data widget with no source/table is "not connected yet" whatever the fetch said — the
  // batch refresh returns a generic "No result" for it, which read as "Couldn't load data".
  // Unless it already carries data: feed snapshots keep only the captured chartData.
  const notConnected = isEmptyDataWidget(widget as never) && !hasRenderableChartData(widget.chartData);

  const chartReady =
    interactive && (onCrossFilter || onWidgetChartClick || chartInteractionMode === 'drill')
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

  // Row clicks (tables) follow the same rule as chart clicks: drill one level when drill levels
  // are set, else filter — always on the field the widget shows now (after a drill, the next
  // level), never the original one.
  const tableClick =
    onCrossFilter || onWidgetChartClick || chartInteractionMode === 'drill'
      ? (field: string, value: unknown) => {
          const shown = effectiveX || field;
          if (!shown) return;
          if (chartInteractionMode === 'drill' && drillPath.length > 0) {
            if (onWidgetChartClick) onWidgetChartClick(widget, shown, value, false);
            else void drillInto(widget.id, shown, value);
            return;
          }
          onCrossFilter?.(shown, value);
        }
      : undefined;

  return (
    <>
      {!hideInteractionHint && interactive && <WidgetInteractionHint widget={widget} />}
      {!hideInteractionHint && <WidgetFilterWarningHint widget={widget} />}
      {widget.unappliedFilters?.length && !widget.error ? (
        // A chart on its own saved SQL can't take a filter on a column that SQL doesn't output.
        // Say so on the card (translated), rather than showing unfiltered numbers as filtered.
        <Tooltip title={t('widget_not_filtered_tip')}>
          <div className="widget-unapplied-filters no-drag" role="note">
            <FilterOutlined aria-hidden />
            <span>
              {t('widget_not_filtered_by', {
                fields: widget.unappliedFilters.map((f) => inferFilterLabel(f.split('.').pop() || f)).join(', '),
              })}
            </span>
          </div>
        </Tooltip>
      ) : null}
      {(widget.chartQuery as { needs_review?: string } | undefined)?.needs_review === 'fanout_join' ? (
        <Alert type="warning" showIcon banner message={t('widget_needs_review_fanout')} style={{ marginBottom: 6 }} />
      ) : null}
      {drillPath.length > 0 && drillState ? (
        <DrillBreadcrumb
          drillPath={drillPath}
          drillState={drillState}
          onNavigate={(level) => void drillUp(widget.id, level)}
          onClear={() => void clearDrill(widget.id)}
        />
      ) : null}
      {notConnected ? (
        <div className="widget-center widget-state">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                <strong>{t('widget_error_not_connected_title')}</strong>
                <span className="widget-state-detail">
                <br />
                {t('widget_error_not_connected_detail')}
                </span>
              </span>
            }
          />
        </div>
      ) : noFieldsChosen ? (
        <div className="widget-center widget-state">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                <strong>{t('widget_no_fields_title')}</strong>
                <span className="widget-state-detail">
                <br />
                {t('widget_no_fields_detail')}
                </span>
              </span>
            }
          />
        </div>
      ) : emptyUnderDates ? (
        // Loaded fine, no rows, and a date filter is on: say why, instead of a bare "No data"
        // that reads as a broken chart (e.g. a "last 30 days" default over last year's data).
        <div className="widget-center widget-state">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                <strong>{t('widget_empty_dates_title')}</strong>
                <span className="widget-state-detail">
                <br />
                {t('widget_empty_dates_detail')}
                </span>
              </span>
            }
          >
            {onClearDateFilters ? (
              <Button size="small" onClick={onClearDateFilters}>
                {t('widget_empty_dates_action')}
              </Button>
            ) : null}
          </Empty>
        </div>
      ) : widget.error && onRetryWidget ? (
        <div className="widget-center widget-error-retry widget-state">
          <Empty
            description={
              <span>
                <strong>{friendlyError.title}</strong>
                <span className="widget-state-detail">
                  <br />
                  {friendlyError.detail}
                </span>
              </span>
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {friendlyError.retryable ? (
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => onRetryWidget(widget.id)}
                >
                  {t('retry')}
                </Button>
              ) : null}
              {friendlyError.technicalDetail ? (
                <ErrorDetailsButton
                  technicalDetail={friendlyError.technicalDetail}
                  label={t('error_show_details')}
                  title={t('error_details_title')}
                />
              ) : null}
            </div>
          </Empty>
        </div>
      ) : (
        <WidgetPreview
          widget={widget}
          dashboardId={dashboardId}
          runtimeFilters={runtimeFilters}
          readOnly={readOnly}
          onFilter={interactive ? tableClick : undefined}
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
