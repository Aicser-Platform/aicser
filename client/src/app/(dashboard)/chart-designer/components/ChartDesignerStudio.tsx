'use client';

import React, { useEffect, useMemo, useCallback } from 'react';
import { ConfigProvider, Spin } from 'antd';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import '../../dashboards/DashboardStudio.css';
import './ChartDesignerStudio.css';
import { WidgetBlockPicker } from '../../dashboards/components/WidgetBlockPicker';
import { PropertiesPanel } from '../../dashboards/Properties/PropertiesPanel';
import DashboardCanvas from '../../dashboards/Canvas/DashboardCanvas';
import { ChartDesignerSidebar } from './ChartDesignerSidebar';
import { ChartDesignerToolbar } from './ChartDesignerToolbar';
import { useChartDesignerStore, type ChartDesignerWidget } from '../stores/useChartDesignerStore';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useTranslations } from 'next-intl';

import { useProjectStore } from '@/stores/useProjectStore';

const generateWidgetId = () => `w_designer_${Date.now()}`;
const DESIGNER_DEFAULT_CHART_HEIGHT = 24;

function EmptyDesignerState({ onSelect }: { onSelect: (template: any) => void }) {
  const t = useTranslations('chart_designer');
  return (
    <div className="canvas-empty">
      <div className="canvas-empty-content animate-in">
        <WidgetBlockPicker variant="canvas" onSelect={onSelect} hintText={t('empty_state_hint')} />
      </div>
    </div>
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
  const setSidebarCollapsed = useChartDesignerStore((state) => state.setSidebarCollapsed);

  const { user, isAuthenticated } = useAuth();
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const clearStore = useChartDesignerStore((state) => state.clearStore);

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      clearStore(); // Clear previous project's charts to avoid flicker
      fetchCharts(user.id, currentProjectId != null ? String(currentProjectId) : undefined);
    }
    // Use `user?.id` (string) instead of `user` (object) to avoid re-running when
    // the user object reference changes but the underlying ID hasn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id, currentProjectId]);

  // Keep both side panels always open for now.
  useEffect(() => {
    setSidebarCollapsed(false);
    setPropertiesCollapsed(false);
  }, [setSidebarCollapsed, setPropertiesCollapsed]);

  // Add widget from template
  const handleAddTemplate = useCallback(
    (template: any) => {
      const newWidget: ChartDesignerWidget = {
        id: generateWidgetId(),
        title: template.name,
        chartType: template.type,
        chartQuery: {},
        chartOptions: {},
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
    },
    [addWidget, user?.id, setSelectedWidgetId]
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
        <Spin size="large" tip={t('loading_designer')} />
      </div>
    );
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#00c2cb',
          borderRadius: 6,
        },
      }}
    >
      <div className="studio-wrapper designer-theme designer-simplified" id="designer-wrapper">
        <div className="studio-body">
          {/* Left Sidebar - Chart List */}
          <ChartDesignerSidebar />

          {/* Canvas Area */}
          <main className="studio-canvas-area designer-canvas">
            <ChartDesignerToolbar selectedWidget={selectedWidget} />
            <div className="designer-fullscreen-canvas">
              <div className="designer-canvas-container">
                {selectedWidget ? (
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

          {/* Right Sidebar - Properties */}
          <PropertiesPanel
            selectedWidget={selectedWidget as any}
            selectedWidgetId={selectedWidgetId}
            widgets={widgets as any[]}
            setWidgets={setWidgets as any}
            removeWidget={deleteChart}
            isCollapsed={false}
            isDesigner={true}
          />
        </div>
      </div>
    </ConfigProvider>
  );
}
