'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Typography, ConfigProvider, Button, Spin, message, Divider, Tag } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  PlusOutlined,
  DashboardOutlined,
  CloseOutlined,
  LineChartOutlined,
  BarChartOutlined,
  AreaChartOutlined,
  PieChartFilled,
} from '@ant-design/icons';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './DashboardStudio.css';
import { PropertiesPanel } from './Properties/PropertiesPanel';
import DashboardCanvas from './Canvas/DashboardCanvas';
import { useDashboardStore, type WidgetInstance, type LayoutItem, WidgetType } from './stores/useDashboardStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { DashboardTabs } from './components/DashboardTabs';
import { chartService, type DashboardTemplate } from './services/chartService';

const { Title, Text } = Typography;
const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

const WIDGET_TEMPLATES = [
  {
    id: 't-line',
    type: 'line',
    name: 'Line ',
    icon: <LineChartOutlined />,
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Line chart using sample data for layout verification.',
  },
  {
    id: 't-bar',
    type: 'bar',
    name: 'Bar ',
    icon: <BarChartOutlined />,
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Bar chart for comparing categories and discrete values.',
  },
  {
    id: 't-area',
    type: 'area',
    name: 'Area ',
    icon: <AreaChartOutlined />,
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Area chart for showing trends over time.',
  },
  {
    id: 't-pie',
    type: 'pie',
    name: 'Pie ',
    icon: <PieChartFilled />,
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Pie chart with stubbed data; useful to test chart slots.',
  },
  {
    id: 't-donut',
    type: 'donut',
    name: 'Donut ',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 672c-123.7 0-224-100.3-224-224s100.3-224 224-224 224 100.3 224 224-100.3 224-224 224z" />
        </svg>
      </div>
    ),
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Donut chart; ideal for displaying proportions with a central hole.',
  },
  {
    id: 't-scatter',
    type: 'scatter',
    name: 'Scatter',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M888 792H232V136c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v704c0 4.4 3.6 8 8 8h720c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8zM312 288c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zm560 216c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zM544 192c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64zm176 416c-35.3 0-64 28.7-64 64s28.7 64 64 64 64-28.7 64-64-28.7-64-64-64z" />
        </svg>
      </div>
    ),
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Scatter plot for showing correlation between two variables.',
  },
  {
    id: 't-heatmap',
    type: 'heatmap',
    name: 'Heatmap',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M128 128v768h768V128H128zm688 688H208V208h608v608zM320 320h128v128H320V320zm256 0h128v128H576V320zM320 576h128v128H320V576zm256 0h128v128H576V576z" />
        </svg>
      </div>
    ),
    category: 'Visuals',
    defaultSize: { w: 6, h: 5 },
    description: 'Heatmap to visualize data density.',
  },
  {
    id: 't-funnel',
    type: 'funnel',
    name: 'Funnel',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M192.1 64h639.8c8.8 0 16 7.2 16 16v121.7c0 4.2-1.7 8.3-4.7 11.3L540.3 515.9V912c0 8.8-7.2 16-16 16h-24.6c-8.8 0-16-7.2-16-16V515.9L180.8 213c-3-3-4.7-7.1-4.7-11.3V80c0-8.8 7.2-16 16-16z" />
        </svg>
      </div>
    ),
    category: 'Indicators',
    defaultSize: { w: 6, h: 5 },
    description: 'Funnel chart for visualizing stages in a process.',
  },
  {
    id: 't-table',
    type: 'table',
    name: 'Table',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M912 192H112c-8.8 0-16 7.2-16 16v560c0 8.8 7.2 16 16 16h800c8.8 0 16-7.2 16-16V208c0-8.8-7.2-16-16-16zM656 256v160H368V256h288zM368 480h288v160H368V480zM160 256h144v160H160V256zm0 224h144v160H160V480zm0 304v-80h144v80H160zm208 0v-80h288v80H368zm496 0H720v-80h144v80zm0-144H720V480h144v160zm0-224H720V256h144v160z" />
        </svg>
      </div>
    ),
    category: 'Data',
    defaultSize: { w: 8, h: 6 },
    description: 'Table widget to display raw data.',
  },
  {
    id: 't-text',
    type: 'text',
    name: 'Text Block',
    icon: (
      <div className="anticon">
        <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
          <path d="M128 128v768h768V128H128zm688 688H208V208h608v608zM320 320h384v64H320V320zm0 192h384v64H320V512zm0 192h256v64H320V704z" />
        </svg>
      </div>
    ),
    category: 'Content',
    defaultSize: { w: 4, h: 3 },
    description: 'Add text notes or descriptions.',
  },
];

const generateWidgetId = () => `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

// Redundant WidgetPreview removed - uses widgets/WidgetPreview.tsx via DashboardCanvas

export default function NewDashboardStudio() {
  const t = useTranslations('dashboards_page');
  const dashboards = useDashboardStore((s) => s.dashboards);
  const isLoadingDashboards = useDashboardStore((s) => s.isLoadingDashboards);
  const hasLoadedDashboards = useDashboardStore((s) => s.hasLoadedDashboards);
  const dashboardError = useDashboardStore((s) => s.dashboardError);
  const widgets = useDashboardStore((s) => s.widgets);
  const layout = useDashboardStore((s) => s.layout);
  const selectedWidgetId = useDashboardStore((s) => s.selectedWidgetId);
  const isPropertiesCollapsed = useDashboardStore((s) => s.isPropertiesCollapsed);
  const setWidgets = useDashboardStore((s) => s.setWidgets);
  const setLayout = useDashboardStore((s) => s.setLayout);
  const setSelectedWidgetId = useDashboardStore((s) => s.setSelectedWidgetId);
  const setPropertiesCollapsed = useDashboardStore((s) => s.setPropertiesCollapsed);
  const addWidgetToStore = useDashboardStore((s) => s.addWidget);
  const removeWidgetFromStore = useDashboardStore((s) => s.removeWidget);
  const duplicateWidgetFromStore = useDashboardStore((s) => s.duplicateWidget);
  const addDashboard = useDashboardStore((s) => s.addDashboard);
  const deleteChart = useDashboardStore((s) => s.deleteChart);
  const fetchDashboards = useDashboardStore((s) => s.fetchDashboards);
  const updateWidgetFromStore = useDashboardStore((s) => s.updateWidget);
  const updateChartLayout = useDashboardStore((s) => s.updateChartLayout);
  const updateChartAndFetchData = useDashboardStore((s) => s.updateChartAndFetchData);
  const isFullscreen = useDashboardStore((s) => s.isFullscreen);
  const setIsFullscreenState = useDashboardStore((s) => s.setIsFullscreen);

  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const [mounted, setMounted] = useState(false);
  const [sampleTemplates, setSampleTemplates] = useState<DashboardTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch dashboards when mounted and project changes
  useEffect(() => {
    if (mounted && (!isEnterpriseEdition || currentProjectId)) {
      fetchDashboards();
    }
  }, [mounted, currentProjectId, fetchDashboards]);

  // Load sample dashboard templates for empty-state onboarding.
  useEffect(() => {
    let cancelled = false;

    const loadTemplates = async () => {
      if (!mounted || dashboards.length > 0) return;
      setIsLoadingTemplates(true);
      try {
        const templates = await chartService.getDashboardTemplates();
        if (!cancelled) {
          setSampleTemplates(templates);
        }
      } catch (error) {
        if (!cancelled) {
          setSampleTemplates([]);
          message.error('Unable to load sample dashboards right now. Please refresh and try again.');
        }
        console.error('Failed to load dashboard templates:', error);
      } finally {
        if (!cancelled) {
          setIsLoadingTemplates(false);
        }
      }
    };

    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [mounted, dashboards.length]);

  // Handle browser fullscreen change
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreenState(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, [setIsFullscreenState]);

  const onUpdateWidget = async (id: string, updates: any) => {
    // Optimistic UI update
    updateWidgetFromStore(id, updates);

    // Persist if widget has chartId (backend connected)
    const widget = widgets.find((w) => w.id === id);
    if (widget?.chartId) {
      try {
        // This will persist AND re-fetch data (overkill for title but ensures consistency)
        await updateChartAndFetchData(id, updates);
      } catch (err) {
        console.error('Failed to save widget updates:', err);
        // Silent fail for title update usually, but maybe show error if critical
      }
    }
  };

  const addWidget = async (template: (typeof WIDGET_TEMPLATES)[number]) => {
    const instanceId = generateWidgetId();

    // Default chart options based on chart type
    const isPieChart = template.type === 'pie' || template.type === 'donut';
    const isTextWidget = template.type === 'text';

    let defaultChartOptions;

    if (isTextWidget) {
      defaultChartOptions = {
        content: '',
        fontSize: 14,
        fontWeight: 400,
        color: 'inherit',
        textAlign: 'left',
      };
    } else if (isPieChart) {
      defaultChartOptions = {
        showLegend: true,
        showDataLabel: false,
        innerRadius: template.type === 'donut' ? 40 : 0,
      };
    } else {
      defaultChartOptions = {
        showLegend: true,
        showDataLabel: false,
        showGridline: true,
        showAxis: true,
      };
    }

    const newWidget: WidgetInstance = {
      id: instanceId,
      dataSourceId: undefined,
      chartQuery: isTextWidget ? {} : undefined,
      chartType: template.type as WidgetType,
      title: isTextWidget ? '' : template.name,
      chartOptions: defaultChartOptions,
    };

    const nextLayoutItem: LayoutItem = {
      i: instanceId,
      x: 0,
      y: Infinity,
      w: template.defaultSize.w,
      h: template.defaultSize.h,
    };

    addWidgetToStore(newWidget, nextLayoutItem);

    // Auto-persist text widgets immediately (they don't need data source selection)
    if (isTextWidget) {
      useDashboardStore.getState().createChartAndFetchData(newWidget);
    }

    // Set widget as selected so user can configure it
    setSelectedWidgetId(instanceId);
  };

  const removeWidget = async (id: string) => {
    const widget = widgets.find((w) => w.id === id);

    // Close properties panel if deleting the selected widget
    if (selectedWidgetId === id) {
      setSelectedWidgetId(null);
      setPropertiesCollapsed(true);
    }

    // Delete from backend if it has a chartId
    if (widget?.chartId) {
      try {
        await deleteChart(id);
        message.success(t('chart_deleted_success'));
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : t('failed_delete_chart');
        console.error('Failed to delete chart:', error);
        message.error(errorMsg);
        // Still remove from UI to prevent orphaned widgets
        removeWidgetFromStore(id);
      }
    } else {
      removeWidgetFromStore(id);
    }
  };

  const duplicateWidget = async (id: string) => {
    try {
      duplicateWidgetFromStore(id);
      message.success(t('widget_duplicated_success'));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : t('failed_duplicate_widget');
      console.error('Failed to duplicate widget:', error);
      message.error(errorMsg);
    }
  };

  const selectedWidget = useMemo(
    () => widgets.find((w) => w.id === selectedWidgetId) ?? null,
    [widgets, selectedWidgetId]
  );

  const createFromTemplate = async (template: DashboardTemplate) => {
    if (isEnterpriseEdition && !currentProjectId) {
      message.error('Please select a project first');
      return;
    }

    setCreatingTemplateId(template.id);
    try {
      const response = await chartService.createDashboardFromTemplate({
        templateId: template.id,
        projectId: currentProjectId,
        dashboardName: template.default_dashboard_name,
      });

      await fetchDashboards();
      const title = response?.dashboard?.title || template.default_dashboard_name || template.name;
      message.success(`Created ${title}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to create sample dashboard';
      message.error(errorMsg);
    } finally {
      setCreatingTemplateId(null);
    }
  };

  if (!mounted) return null;

  // Show error state if fetching failed
  if (dashboardError) {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#00c2cb',
            borderRadius: 6,
          },
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100%',
            textAlign: 'center',
            gap: '24px',
            padding: '48px',
          }}
        >
          <Title level={3} type="danger">
            {t('failed_load')}
          </Title>
          <Text type="secondary">{dashboardError}</Text>
          <Button type="primary" onClick={() => fetchDashboards()}>
            {t('retry')}
          </Button>
        </div>
      </ConfigProvider>
    );
  }

  // Show loading state while fetching dashboards or waiting for project or first load
  if (isLoadingDashboards || (isEnterpriseEdition && !currentProjectId) || !hasLoadedDashboards) {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#00c2cb',
            borderRadius: 6,
          },
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100%',
            gap: '16px',
          }}
        >
          <Spin size="large" />
          <Text type="secondary">
            {isEnterpriseEdition && !currentProjectId ? t('waiting_project') : t('loading_dashboards')}
          </Text>
        </div>
      </ConfigProvider>
    );
  }

  // Show empty state ONLY when project is selected but has no dashboards
  if (dashboards.length === 0) {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#00c2cb',
            borderRadius: 6,
          },
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100%',
            textAlign: 'center',
            gap: '24px',
            padding: '48px',
            background: 'var(--ant-color-bg-container)',
          }}
        >
          <DashboardOutlined style={{ fontSize: '64px', color: 'var(--color-brand-primary)' }} />
          <div>
            <Title level={3} style={{ margin: '0 0 8px 0' }}>
              {t('create_first_dashboard')}
            </Title>
            <Text type="secondary" style={{ fontSize: '14px' }}>
              {t('create_first_dashboard_desc')}
            </Text>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => addDashboard()}
            style={{ marginTop: '16px' }}
          >
            {t('create_dashboard')}
          </Button>

          <Divider style={{ margin: '8px 0 0 0', maxWidth: '840px' }}>or start from a sample dashboard</Divider>

          {isLoadingTemplates ? (
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
              <Spin size="small" />
            </div>
          ) : sampleTemplates.length > 0 ? (
            <div
              style={{
                width: '100%',
                maxWidth: 1080,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                gap: 12,
                marginTop: 8,
              }}
            >
              {sampleTemplates.map((template) => (
                <div
                  key={template.id}
                  style={{
                    border: '1px solid var(--ant-color-border)',
                    borderRadius: 10,
                    padding: 14,
                    background: 'var(--ant-color-bg-elevated)',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    minHeight: 232,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <Text strong style={{ lineHeight: 1.3 }}>
                      {template.name}
                    </Text>
                    <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
                      {template.category}
                    </Tag>
                  </div>

                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {template.description}
                  </Text>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(template.widgets || []).slice(0, 3).map((widget) => (
                      <Tag key={`${template.id}-${widget.name}`} style={{ marginInlineEnd: 0 }}>
                        {widget.name}
                      </Tag>
                    ))}
                  </div>

                  <Button
                    type="default"
                    loading={creatingTemplateId === template.id}
                    onClick={() => createFromTemplate(template)}
                    style={{ marginTop: 'auto' }}
                  >
                    Use Template
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Text type="secondary" style={{ marginTop: 12 }}>
              No sample dashboards available right now.
            </Text>
          )}
        </div>
      </ConfigProvider>
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
      <div className="studio-wrapper" id="studio-wrapper">
        {isFullscreen && (
          <div className="fullscreen-exit-overlay">
            <div className="fullscreen-exit-btn" onClick={() => document.exitFullscreen()}>
              <CloseOutlined style={{ fontSize: '14px' }} />
              <span>{t('exit_fullscreen')}</span>
            </div>
          </div>
        )}
        <div className="studio-body">
          <main
            className="studio-canvas-area"
            style={{
              flexDirection: 'column',
              display: 'flex',
              padding: 0,
            }}
          >
            {/* Dashboard Selector Tabs & Toolbar — Hidden in Fullscreen */}
            {!isFullscreen && <DashboardTabs />}

            {/* Float title in fullscreen */}
            {isFullscreen && dashboards.find((d) => d.id === useDashboardStore.getState().activeDashboardId) && (
              <div style={{ padding: '48px 48px 0 48px' }}>
                <Title level={2} style={{ margin: 0 }}>
                  {dashboards.find((d) => d.id === useDashboardStore.getState().activeDashboardId)?.name}
                </Title>
              </div>
            )}

            <div
              style={{
                flex: 1,
                width: '100%',
                overflowX: 'hidden',
                overflowY: 'auto',
                minHeight: 0,
                padding: isFullscreen ? '12px 48px 48px 48px' : '16px',
              }}
              onClick={() => {
                setSelectedWidgetId(null);
                setPropertiesCollapsed(true);
              }}
            >
              <DashboardCanvas
                widgets={widgets}
                layout={layout}
                selectedWidgetId={selectedWidgetId}
                setSelectedWidgetId={setSelectedWidgetId}
                setLayout={setLayout}
                removeWidget={removeWidget}
                duplicateWidget={duplicateWidget}
                onAddWidget={(template) => {
                  if (template) addWidget(template);
                }}
                onDropWidget={(template) => addWidget(template)}
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
            </div>
          </main>

          {/* Right toggle button — absolute overlay, does not affect canvas width */}
          {selectedWidgetId && selectedWidget?.chartType !== 'text' && (
            <div
              className={`sidebar-toggle-btn right ${isPropertiesCollapsed ? 'collapsed' : ''}`}
              onClick={() => setPropertiesCollapsed(!isPropertiesCollapsed)}
              style={{
                right: isPropertiesCollapsed ? 0 : '300px',
                zIndex: 60,
              }}
            >
              {isPropertiesCollapsed ? (
                <LeftOutlined style={{ fontSize: '10px' }} />
              ) : (
                <RightOutlined style={{ fontSize: '10px' }} />
              )}
            </div>
          )}

          {/* Right Sidebar Properties — absolute overlay, does NOT push canvas */}
          <PropertiesPanel
            selectedWidget={selectedWidget}
            selectedWidgetId={selectedWidgetId}
            widgets={widgets}
            setWidgets={setWidgets}
            removeWidget={removeWidget}
            isCollapsed={isPropertiesCollapsed}
          />
        </div>
      </div>
    </ConfigProvider>
  );
}
