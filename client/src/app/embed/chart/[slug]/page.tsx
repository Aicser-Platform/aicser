'use client';

import React, { Suspense, useEffect, useState } from 'react';
import nextDynamic from 'next/dynamic';
import { useParams, useSearchParams } from 'next/navigation';
import { Alert, Spin, Typography } from 'antd';
import { notifyEmbedError, notifyEmbedReady, notifyEmbedResize, parseEmbedErrorDetail } from '@/utils/embedMessaging';
import { useEmbedTheme } from '@/hooks/useEmbedTheme';
import { EmbedBrandingFooter } from '@/components/embed/EmbedBrandingFooter';
import { buildChartOptions } from '@/app/(dashboard)/dashboards/widgets/ChartOptionsBuilder';

const ChartRenderer = nextDynamic(
  () => import('@/app/embedded/chart/[slug]/components/ChartRenderer'),
  { ssr: false }
);

const { Title } = Typography;

// The backend used to (incorrectly) return a pre-built `echarts_option` from
// a `widgets.config` column that doesn't exist (see the router fix). The
// real `charts` table only stores the query definition (chart_query) and
// style config (chart_options) - actual chart data has to be executed
// server-side and the echarts option built here, client-side, the same way
// every other chart in the app does it (ChartOptionsBuilder.buildChartOptions,
// also used by the dashboard/chart-designer canvas).
type EmbedChart = {
  id: string;
  title?: string;
  chart_type?: string;
  chart_query?: Record<string, unknown>;
  chart_options?: Record<string, unknown>;
  data?: unknown;
};

function EmbedChartContent({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';
  const { theme, themeStyle, dataTheme } = useEmbedTheme(token);

  const [chart, setChart] = useState<EmbedChart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setError('Chart slug is required');
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Same-origin, through the Next.js /api/* proxy (pages/api/[...path].ts,
        // which forwards a `charts/...` path straight to the backend's own
        // `/charts/...` route) — not `getBackendUrl()`'s raw NEXT_PUBLIC_API_URL,
        // which is meant to be a Docker-internal hostname for server-side use
        // and isn't reachable from a visitor's actual browser. See
        // embedDashboard.ts's fetchEmbedDashboardPayload for the same fix.
        const qs = token ? `?token=${encodeURIComponent(token)}` : '';
        const res = await fetch(`/api/charts/embed/${encodeURIComponent(slug)}${qs}`);
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(parseEmbedErrorDetail(detail, `Failed to load chart (${res.status})`));
        }
        const data = (await res.json()) as EmbedChart;
        setChart(data);
        notifyEmbedReady({ kind: 'chart', slug, chartId: data.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load chart';
        setError(message);
        notifyEmbedError(message, 'chart_load_failed');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [slug, token]);

  useEffect(() => {
    if (!loading && chart) notifyEmbedResize(520);
  }, [loading, chart]);

  if (loading) {
    return (
      <div style={themeStyle} data-theme={dataTheme}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 360 }}>
          <Spin size="large" tip="Loading chart..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={themeStyle} data-theme={dataTheme}>
        <Alert type="error" message="Unable to load chart" description={error} showIcon style={{ margin: 24 }} />
      </div>
    );
  }

  let optionJson = '';
  try {
    if (chart?.data) {
      const built = buildChartOptions(
        chart.chart_type || 'bar',
        chart.data as never,
        (chart.chart_options as never) || {},
      );
      optionJson = built ? JSON.stringify(built) : '';
    }
  } catch {
    optionJson = '';
  }

  if (!optionJson) {
    return (
      <div style={themeStyle} data-theme={dataTheme}>
        <Alert type="warning" message="Chart has no renderable options" showIcon style={{ margin: 24 }} />
      </div>
    );
  }

  return (
    <div style={{ ...themeStyle, width: '100%', minHeight: 480 }} data-theme={dataTheme}>
      {chart?.title ? (
        <Title level={4} style={{ padding: '12px 16px', margin: 0 }}>
          {chart.title}
        </Title>
      ) : null}
      <ChartRenderer value={optionJson} />
      <EmbedBrandingFooter hidden={theme?.hide_aicser_branding} />
    </div>
  );
}

export default function EmbedChartPage() {
  const routeParams = useParams();
  const slug = typeof routeParams?.slug === 'string' ? routeParams.slug : '';
  return (
    <Suspense fallback={<Spin style={{ margin: 48 }} />}>
      <EmbedChartContent slug={slug} />
    </Suspense>
  );
}
