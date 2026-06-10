'use client';

import React, { Suspense, useEffect, useState } from 'react';
import nextDynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Alert, Spin, Typography } from 'antd';
import { getBackendUrl } from '@/utils/backendUrl';
import { notifyEmbedError, notifyEmbedReady, notifyEmbedResize } from '@/utils/embedMessaging';

const ChartRenderer = nextDynamic(
  () => import('@/app/embedded/chart/[slug]/components/ChartRenderer'),
  { ssr: false }
);

const { Title } = Typography;

type EmbedChart = {
  id: string;
  title?: string;
  chart_option?: unknown;
  echarts_option?: unknown;
};

function EmbedChartContent({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';

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
        const base = getBackendUrl();
        const qs = token ? `?token=${encodeURIComponent(token)}` : '';
        const res = await fetch(`${base}/charts/embed/${encodeURIComponent(slug)}${qs}`);
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.detail || `Failed to load chart (${res.status})`);
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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 360 }}>
        <Spin size="large" tip="Loading chart..." />
      </div>
    );
  }

  if (error) {
    return <Alert type="error" message="Unable to load chart" description={error} showIcon style={{ margin: 24 }} />;
  }

  const option = chart?.echarts_option || chart?.chart_option;
  const optionJson = option ? JSON.stringify(option) : '';

  if (!optionJson) {
    return <Alert type="warning" message="Chart has no renderable options" showIcon style={{ margin: 24 }} />;
  }

  return (
    <div style={{ width: '100%', minHeight: 480 }}>
      {chart?.title ? (
        <Title level={4} style={{ padding: '12px 16px', margin: 0 }}>
          {chart.title}
        </Title>
      ) : null}
      <ChartRenderer value={optionJson} />
    </div>
  );
}

export default function EmbedChartPage({ params }: { params: { slug: string } }) {
  const slug = params?.slug || '';
  return (
    <Suspense fallback={<Spin style={{ margin: 48 }} />}>
      <EmbedChartContent slug={slug} />
    </Suspense>
  );
}
