'use client';

import React, { useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button, ConfigProvider, Segmented, Spin, Typography, message } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { SharedChartRenderer } from '@/components/charts/SharedChartRenderer';
import { usePanelCollapsed } from '@/components/layout/SidePanel';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import '../../dashboards/DashboardStudio.css';
import './ChartDesignerStudio.css';
import { WidgetBlockPicker } from '../../dashboards/components/WidgetBlockPicker';
import { PropertiesPanel } from '../../dashboards/Properties/PropertiesPanel';
import DashboardCanvas from '../../dashboards/Canvas/DashboardCanvas';
import { ChartDesignerSidebar } from './ChartDesignerSidebar';
import { ChartDesignerToolbar } from './ChartDesignerToolbar';
import { ChartDataTable } from './ChartDataTable';
import { useChartDesignerStore, type ChartDesignerWidget } from '../stores/useChartDesignerStore';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useTranslations } from 'next-intl';

import { useProjectStore } from '@/stores/useProjectStore';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { useSearchParams } from 'next/navigation';
import {
  peekSavedQueryBind,
  consumeSavedQueryBind,
  buildChartQueryFromBind,
} from '../../dashboards/utils/queryBindBridge';
import { chartBuilderService } from '../services/chartBuilderService';
import { mapApiChartToDesignerWidget } from '@/components/charts/chartDesignerBridge';
import type { WidgetTemplate } from '../../dashboards/widgetTemplates';

const generateWidgetId = () => `w_designer_${Date.now()}`;
const DESIGNER_DEFAULT_CHART_HEIGHT = 24;

/** No chart open: one heading, the chart types once, and the latest charts to pick up again. */
function EmptyDesignerState({ onSelect }: { onSelect: (template: any) => void }) {
  const t = useTranslations('chart_designer');
  return (
    <div className="canvas-empty">
      <div className="canvas-empty-content animate-in chart-designer-empty">
        <Typography.Title level={4} style={{ marginBottom: 4 }}>{t('empty_title')}</Typography.Title>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
          {t('empty_subtitle')}
        </Typography.Text>
        <WidgetBlockPicker variant="canvas" chartsOnly title={null} onSelect={onSelect} />
      </div>
    </div>
  );
}

type PreviewWidth = 'desktop' | 'tablet' | 'phone';
const PREVIEW_WIDTHS: Record<PreviewWidth, number | null> = { desktop: null, tablet: 768, phone: 390 };

/** The chart as viewers see it — full width, or at a tablet or phone width — without the editor around it. */
function ChartPreview({ widget, onClose }: { widget: ChartDesignerWidget; onClose: () => void }) {
  const t = useTranslations('chart_designer');
  const [size, setSize] = React.useState<PreviewWidth>('desktop');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const width = PREVIEW_WIDTHS[size];
  const subtitle = typeof widget.chartOptions?.subtitle === 'string' ? widget.chartOptions.subtitle : '';
  // Rendered on <body>: inside the studio it would sit under the app header (stacking context).
  return createPortal(
    <div className="chart-designer-preview" role="dialog" aria-modal="true" aria-label={t('full_screen')}>
      <div className="chart-designer-preview__bar">
        <Segmented
          size="small"
          value={size}
          onChange={(v) => setSize(v as PreviewWidth)}
          options={(['desktop', 'tablet', 'phone'] as PreviewWidth[]).map((k) => ({ value: k, label: t(`preview_${k}`) }))}
        />
        <Button icon={<CloseOutlined />} onClick={onClose}>{t('preview_close')}</Button>
      </div>
      <div className="chart-designer-preview__stage">
        <article className="chart-designer-preview__frame" style={width ? { width } : undefined}>
          <Typography.Title level={4} style={{ margin: 0 }}>{widget.title || t('untitled_chart')}</Typography.Title>
          {subtitle ? <Typography.Text type="secondary">{subtitle}</Typography.Text> : null}
          <div className="chart-designer-preview__chart">
            <SharedChartRenderer
              chartType={widget.chartType}
              chartData={widget.chartData}
              chartOptions={{ ...(widget.chartOptions || {}), hideTitle: true }}
              chartQuery={widget.chartQuery}
              isLoading={widget.isLoading}
              error={widget.error}
              minHeight={size === 'phone' ? 320 : 460}
            />
          </div>
        </article>
      </div>
    </div>,
    document.body,
  );
}

export default function ChartDesignerStudio() {
  const t = useTranslations('chart_designer');
  const widgets = useChartDesignerStore((state) => state.widgets);
  const layout = useChartDesignerStore((state) => state.layout);
  const selectedWidgetId = useChartDesignerStore((state) => state.selectedWidgetId);
  const isLoading = useChartDesignerStore((state) => state.isLoading);

  const setWidgets = useChartDesignerStore((state) => state.setWidgets);
  const setLayout = useChartDesignerStore((state) => state.setLayout);
  const setSelectedWidgetId = useChartDesignerStore((state) => state.setSelectedWidgetId);
  const setPropertiesCollapsed = useChartDesignerStore((state) => state.setPropertiesCollapsed);
  const addWidget = useChartDesignerStore((state) => state.addWidget);
  const updateWidget = useChartDesignerStore((state) => state.updateWidget);
  const duplicateWidget = useChartDesignerStore((state) => state.duplicateWidget);
  const fetchCharts = useChartDesignerStore((state) => state.fetchCharts);
  const deleteChart = useChartDesignerStore((state) => state.deleteChart);
  const updateChartLayout = useChartDesignerStore((state) => state.updateChartLayout);

  const { user, isAuthenticated } = useAuth();
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const clearStore = useChartDesignerStore((state) => state.clearStore);
  const searchParams = useSearchParams();
  const createChartAndFetchData = useChartDesignerStore((state) => state.createChartAndFetchData);
  const bindAppliedRef = React.useRef(false);

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      clearStore(); // Clear previous project's charts to avoid flicker
      fetchCharts(user.id, currentProjectId != null ? String(currentProjectId) : undefined);
    }
    // Use `user?.id` (string) instead of `user` (object) to avoid re-running when
    // the user object reference changes but the underlying ID hasn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id, currentProjectId]);

  const [propertiesFolded, setPropertiesFolded] = usePanelCollapsed('designer.properties');

  // Query Editor → chart designer bind (AFTER fetchCharts finishes — avoids wipe race)
  useEffect(() => {
    if (searchParams?.get('bind_saved_query') !== '1') return;
    if (isLoading) return; // wait for store hydrate
    if (bindAppliedRef.current) return;

    if (!peekSavedQueryBind()) return;

    const payload = consumeSavedQueryBind();
    if (!payload) return;
    bindAppliedRef.current = true;

    // Library chart already created — open it instead of duplicating
    if (payload.preCreatedChartId) {
      void chartBuilderService
        .getChart(String(payload.preCreatedChartId))
        .then((chart) => {
          if (!chart?.id) return;
          const mapped = mapApiChartToDesignerWidget(chart as Record<string, unknown>, user?.id || '');
          if (!useChartDesignerStore.getState().widgets.some((w) => String(w.chartId) === String(chart.id))) {
            addWidget(mapped.widget, mapped.layout);
          }
          setSelectedWidgetId(mapped.widget.id);
          setPropertiesCollapsed(false);
          message.success(`Opened “${mapped.widget.title}” from query`);
        })
        .catch((err) => {
          console.error(err);
          message.warning('Could not open library chart');
        });
      return;
    }

    const chartQuery = buildChartQueryFromBind(payload);
    const chartType = payload.chartType || 'bar';
    const id = generateWidgetId();
    const widget: ChartDesignerWidget = {
      id,
      title: payload.name || 'Query chart',
      chartType,
      dataSourceId: payload.dataSourceId,
      chartQuery,
      chartOptions: { showLegend: chartType !== 'stat' && chartType !== 'table' },
      chartData: payload.chartData,
    };
    addWidget(widget, {
      i: id,
      x: 0,
      y: 0,
      w: 12,
      h: chartType === 'stat' ? 10 : DESIGNER_DEFAULT_CHART_HEIGHT,
    });
    setSelectedWidgetId(id);
    setPropertiesCollapsed(false);
    void createChartAndFetchData(widget).then(() => {
      message.success(`Created “${widget.title}” from query`);
    }).catch((err) => {
      console.error(err);
      message.warning('Chart created locally — data may need Apply Changes');
    });
  }, [
    searchParams,
    isLoading,
    user?.id,
    addWidget,
    setSelectedWidgetId,
    setPropertiesCollapsed,
    createChartAndFetchData,
  ]);

  // Add widget from template
  const handleAddTemplate = useCallback(
    (template: WidgetTemplate) => {
      const dsState = useDataSourceStore.getState();
      // The store only tracks `selectedId` - the data source list itself lives in the
      // useDataSources() React Query cache, not in this Zustand store, so there's no
      // "first available data source" to imperatively fall back to here.
      const dataSourceId = dsState.selectedId != null ? String(dsState.selectedId) : undefined;

      const newWidget: ChartDesignerWidget = {
        id: generateWidgetId(),
        title: template.name,
        chartType: template.type,
        chartQuery: {},
        chartOptions: {},
        dataSourceId,
        isLoading: false,
        error: null,
        userId: user?.id,
      };

      const newLayout = template.defaultSize
        ? {
            i: newWidget.id,
            x: 0,
            y: 0,
            w: 12,
            h: DESIGNER_DEFAULT_CHART_HEIGHT,
            maxH: DESIGNER_DEFAULT_CHART_HEIGHT,
          }
        : undefined;

      addWidget(newWidget, newLayout);
      setSelectedWidgetId(newWidget.id);
      setPropertiesCollapsed(false);
    },
    [addWidget, user?.id, setSelectedWidgetId, setPropertiesCollapsed],
  );

  const onUpdateWidget = useCallback(
    (id: string, updates: any) => {
      updateWidget(id, updates);
    },
    [updateWidget]
  );

  const selectedWidget = useMemo(
    () => widgets.find((w) => w.id === selectedWidgetId) ?? null,
    [widgets, selectedWidgetId]
  );

  // Chart or the table of its data; each newly opened chart starts on the chart.
  const [canvasView, setCanvasView] = React.useState<'chart' | 'data'>('chart');
  useEffect(() => setCanvasView('chart'), [selectedWidgetId]);
  const [previewing, setPreviewing] = React.useState(false);

  const selectedWidgetLayout = useMemo(() => {
    if (!selectedWidgetId) return [];

    return layout
      .filter((l) => l.i === selectedWidgetId)
      .map((l) => ({
        ...l,
        x: 0,
        y: 0,
        w: 12,
        h: DESIGNER_DEFAULT_CHART_HEIGHT,
        maxH: DESIGNER_DEFAULT_CHART_HEIGHT,
      }));
  }, [layout, selectedWidgetId]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100%' }}>
        <Spin size="large" description={t('loading_designer')} />
      </div>
    );
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 6,
        },
      }}
    >
      <div className="studio-wrapper designer-theme designer-simplified chart-designer-studio" id="designer-wrapper">
        <div className="studio-body">
          {/* Left Sidebar - Chart List */}
          <ChartDesignerSidebar onAddTemplate={handleAddTemplate} />

          {/* Canvas Area */}
          <main className="studio-canvas-area designer-canvas">
            {selectedWidget ? (
              <ChartDesignerToolbar selectedWidget={selectedWidget} view={canvasView} onViewChange={setCanvasView}
                onPreview={() => setPreviewing(true)} />
            ) : null}
            <div className="designer-fullscreen-canvas">
              <div className="designer-canvas-container">
                {selectedWidget && canvasView === 'data' ? (
                  <ChartDataTable widget={selectedWidget} />
                ) : selectedWidget ? (
                  <DashboardCanvas
                    widgets={[selectedWidget]}
                    layout={selectedWidgetLayout}
                    selectedWidgetId={selectedWidgetId}
                    setSelectedWidgetId={setSelectedWidgetId}
                    setLayout={(newLayout) => {
                      // We only want to accept width/height changes (resizes) from the Designer.
                      // We map newLayout back over the original store layout to restore original X/Y
                      // so we don't accidentally send x:0, y:0 to the dashboard DB layout!
                      const mergedLayout = layout.map((orig) => {
                        const updated = newLayout.find((l) => l.i === orig.i);
                        return updated ? { ...orig, w: updated.w, h: updated.h } : orig;
                      });
                      setLayout(mergedLayout);
                    }}
                    removeWidget={deleteChart}
                    duplicateWidget={duplicateWidget}
                    onAddWidget={handleAddTemplate}
                    setPropertiesCollapsed={setPropertiesCollapsed}
                    onUpdateWidget={onUpdateWidget}
                    onLayoutSync={(newLayout) => {
                      newLayout.forEach((l) => {
                        const widget = widgets.find((w) => w.id === l.i);
                        // Only sizes are kept here (x/y stay put), so only a resize is worth saving —
                        // the canvas's overlap heal on open moved x/y and saved every chart.
                        const before = layout.find((o) => o.i === l.i);
                        if (before && before.w === l.w && before.h === l.h) return;
                        if (widget?.chartId) {
                          updateChartLayout(widget.id);
                        }
                      });
                    }}
                  />
                ) : (
                  <EmptyDesignerState onSelect={handleAddTemplate} />
                )}
              </div>
            </div>
          </main>

          {/* Right Sidebar - Properties (only while a chart is open: nothing to edit otherwise) */}
          {selectedWidget ? (
          <PropertiesPanel
            selectedWidget={selectedWidget as any}
            selectedWidgetId={selectedWidgetId}
            widgets={widgets as any[]}
            setWidgets={setWidgets as any}
            removeWidget={deleteChart}
            isCollapsed={propertiesFolded}
            onCollapse={() => setPropertiesFolded(true)}
            onExpand={() => setPropertiesFolded(false)}
            isDesigner={true}
          />
          ) : null}
        </div>
        {previewing && selectedWidget ? <ChartPreview widget={selectedWidget} onClose={() => setPreviewing(false)} /> : null}
      </div>
    </ConfigProvider>
  );
}
