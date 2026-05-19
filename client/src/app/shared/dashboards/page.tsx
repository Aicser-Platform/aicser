'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { AppstoreOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { App, ConfigProvider } from 'antd';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { chartService } from '@/app/(dashboard)/dashboards/services/chartService';
import { WidgetRenderer } from '@/app/(dashboard)/dashboards/widgets/WidgetRenderer';
import { type WidgetInstance, type LayoutItem } from '@/app/(dashboard)/dashboards/stores/useDashboardStore';
import AiserLogo from '@/components/ui/Logo/AiserLogo';
import '@/app/(dashboard)/dashboards/DashboardStudio.css';
import './SharedDashboard.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

function SharedDashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const dashboardId = searchParams ? searchParams.get('id') || '' : '';

  const [dashboard, setDashboard] = useState<any>(null);
  const [widgets, setWidgets] = useState<WidgetInstance[]>([]);
  const [layout, setLayout] = useState<LayoutItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dashboardId) return;

    const loadDashboardData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // 1. Fetch Charts First (more reliably available via GET)
        let charts: any[] = [];
        try {
          charts = await chartService.listCharts(dashboardId);
        } catch (err: any) {
          console.error('Failed to list charts:', err);
          throw new Error('Could not load dashboard content. Please check the ID.');
        }

        // 2. Try Fetching Dashboard Info
        try {
          const dashInfo = (await chartService.getDashboard(dashboardId)) as any;
          // Prefer 'title' as confirmed by user, but keep 'name' as fallback
          setDashboard({
            ...dashInfo,
            displayTitle: dashInfo.title || dashInfo.name || 'Dashboard',
          });
        } catch (err) {
          console.warn('Dashboard info fetch failed:', err);
          // Fallback if metadata fetch fails
          setDashboard({
            id: dashboardId,
            displayTitle: 'Dashboard',
          });
        }

        // 3. Prepare Widgets and Layout
        const initialWidgets: WidgetInstance[] = charts.map((chart: any) => ({
          id: `widget-${chart.id}`,
          chartId: chart.id,
          dataSourceId: chart.dataSourceId,
          title: chart.title || '',
          chartType: chart.chartType as any,
          chartQuery: chart.chartQuery,
          chartOptions: chart.chartOptions,
          chartData: undefined,
          isLoading: !!chart.dataSourceId,
          error: null,
        }));

        const initialLayout: LayoutItem[] = charts.map((chart: any) => {
          const chartLayout = chart.layout || {};
          return {
            i: `widget-${chart.id}`,
            x: chartLayout.x ?? 0,
            y: chartLayout.y ?? 0,
            w: chartLayout.w ?? 4,
            h: chartLayout.h ?? 5,
          };
        });

        setWidgets(initialWidgets);
        setLayout(initialLayout);

        // 4. Fetch Data for each chart
        // We do this individually to avoid failing the whole dashboard if one chart has an issue
        initialWidgets.forEach(async (widget) => {
          if (!widget.chartId || !widget.dataSourceId) return;

          try {
            const response = await chartService.executeChart(dashboardId, widget.chartId);
            setWidgets((prev) =>
              prev.map((w) =>
                w.id === widget.id
                  ? {
                      ...w,
                      chartData: response.data,
                      // Sync chartOptions from execution in case they were updated or missing from initial list
                      chartOptions: { ...(w.chartOptions || {}), ...(response.chart?.chartOptions || {}) },
                      isLoading: false,
                    }
                  : w
              )
            );
          } catch (err) {
            console.error(`Failed to fetch data for chart ${widget.chartId}:`, err);
            setWidgets((prev) =>
              prev.map((w) => (w.id === widget.id ? { ...w, isLoading: false, error: 'Data unavailable' } : w))
            );
          }
        });
      } catch (err: any) {
        console.error('Failed to load shared dashboard:', err);
        setError(err.message || 'Failed to load dashboard');
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboardData();
  }, [dashboardId]);

  if (!dashboardId) {
    return (
      <div className="shared-dashboard-error">
        <div className="shared-dashboard-error-icon">
          <ExclamationCircleOutlined />
        </div>
        <div className="shared-dashboard-error-title">No Dashboard ID Provided</div>
        <div className="shared-dashboard-error-message">You need a valid dashboard ID to view this page.</div>
        <button className="shared-dashboard-back-btn" onClick={() => router.push('/')}>
          Go to Home
        </button>
      </div>
    );
  }

  if (isLoading && !dashboard) {
    return (
      <div className="shared-dashboard-loading">
        <div className="shared-dashboard-loading-spinner"></div>
        <div className="shared-dashboard-error-title">Loading Dashboard...</div>
        <div className="shared-dashboard-error-message">We're fetching the latest data for you.</div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="shared-dashboard-error">
        <div className="shared-dashboard-error-icon">
          <ExclamationCircleOutlined />
        </div>
        <div className="shared-dashboard-error-title">Dashboard Not Found</div>
        <div className="shared-dashboard-error-message">
          {error || "The dashboard you're looking for doesn't exist or is no longer available."}
        </div>
        <button className="shared-dashboard-back-btn" onClick={() => router.push('/')}>
          Go to Home
        </button>
      </div>
    );
  }

  const handleGoToBase = () => {
    router.push('/dashboards');
  };

  return (
    <div className="shared-dashboard-container" style={{ fontFamily: 'var(--font-sans)' }}>
      {/* Studio-aligned Header */}
      <header className="shared-dashboard-header">
        <div className="shared-dashboard-header-left">
          <div
            className="shared-dashboard-logo-container"
            onClick={() => router.push('/')}
            style={{ cursor: 'pointer' }}
          >
            <AiserLogo size={32} showText={true} />
          </div>
          <div
            className="header-divider"
            style={{ width: 1, height: 16, background: 'rgba(0,0,0,0.1)', margin: '0 12px' }}
          />
          <div
            className="header-breadcrumb"
            style={{ fontSize: '13px', color: '#57606a', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span>Dashboards</span>
            <span style={{ color: '#d1d5db' }}>/</span>
            <span style={{ color: '#24292f', fontWeight: 600 }}>{dashboard?.displayTitle || 'Dashboard'}</span>
          </div>
        </div>

        <div className="shared-dashboard-header-right">
          <button className="shared-dashboard-go-to-base-btn" onClick={handleGoToBase}>
            <AppstoreOutlined style={{ marginRight: 8 }} /> Go to dashboards
          </button>
        </div>
      </header>

      <main className="shared-dashboard-content" style={{ padding: '16px' }}>
        {/* Read-only Grid (Shifted up by removing meta block) */}

        <div className="dashboard-canvas-wrapper" style={{ minHeight: 'calc(100vh - 200px)' }}>
          <ResponsiveGridLayout
            className="layout"
            layouts={{ lg: layout, md: layout, sm: layout, xs: layout, xxs: layout }}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={42}
            margin={[8, 8]}
            containerPadding={[0, 0]}
            isDraggable={false}
            isResizable={false}
            useCSSTransforms={true}
          >
            {widgets.map((widget: WidgetInstance) => {
              const type = widget.chartType;
              const isText = type === 'text';
              const hasTitle = widget.title && widget.title.trim() !== '';
              const isSelected = false; // Never selected in shared view
              const showHeader = !isText || hasTitle;

              return (
                <div key={widget.id}>
                  <div
                    className={`widget-card ${isSelected ? 'selected' : ''} widget-type-${type} ${!showHeader ? 'header-hidden' : ''}`}
                    style={{
                      // Support both legacy chartOptions and newer studio 'style' property
                      backgroundColor:
                        (widget as any).style?.backgroundColor || widget.chartOptions?.backgroundColor || undefined,
                      color:
                        (widget as any).style?.color ||
                        widget.chartOptions?.textColor ||
                        widget.chartOptions?.color ||
                        'inherit',
                      // Studio parity: transparent background should remove container boundary
                      border:
                        (widget as any).style?.backgroundColor === 'transparent' ||
                        widget.chartOptions?.backgroundColor === 'transparent'
                          ? 'none'
                          : undefined,
                      boxShadow:
                        (widget as any).style?.backgroundColor === 'transparent' ||
                        widget.chartOptions?.backgroundColor === 'transparent'
                          ? 'none'
                          : undefined,
                    }}
                  >
                    {/* Studio-aligned Header */}
                    {showHeader && (
                      <div className="widget-card-header">
                        <span
                          className="widget-card-title"
                          style={{
                            fontWeight:
                              (widget as any).style?.fontWeight || widget.chartOptions?.titleFontWeight || '700',
                            color: (widget as any).style?.color || widget.chartOptions?.titleColor || undefined,
                          }}
                        >
                          {widget.title}
                        </span>
                      </div>
                    )}

                    <div className={`widget-card-body ${isText && !showHeader ? 'drag-handle' : 'no-drag'}`}>
                      <WidgetRenderer
                        type={type}
                        data={widget.chartData}
                        config={widget.chartOptions}
                        query={widget.chartQuery}
                        isLoading={widget.isLoading}
                        error={widget.error}
                        readOnly={true}
                        isSelected={isSelected}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </ResponsiveGridLayout>
        </div>
      </main>
    </div>
  );
}

export default function SharedDashboardPage() {
  return (
    <AntdRegistry>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#00c2cb',
            borderRadius: 6,
            colorBgLayout: '#ffffff',
            colorBgContainer: '#f8f9fa',
            colorBgElevated: '#f1f3f5',
          },
          components: {
            Table: {
              headerBg: '#f1f3f5',
            },
            Input: {
              colorBgContainer: '#f8f9fa',
            },
          },
        }}
      >
        <App>
          <Suspense
            fallback={
              <div className="shared-dashboard-loading">
                <div className="shared-dashboard-loading-spinner"></div>
                <div className="shared-dashboard-error-title">Loading...</div>
              </div>
            }
          >
            <SharedDashboardContent />
          </Suspense>
        </App>
      </ConfigProvider>
    </AntdRegistry>
  );
}
