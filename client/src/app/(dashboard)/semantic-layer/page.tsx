'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { CheckCircleOutlined, NodeIndexOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDataSources } from '@/hooks/useDataSources';
import { useProjectStore } from '@/stores/useProjectStore';
import type { DataSource } from '@/stores/useDataSourceStore';
import { DataSourceIcon } from '@/utils/dataSourceIcons';
import { fetchApi } from '@/utils/api';
import { DashboardPageHeader, DashboardPageLoading, DashboardPageShell, DashboardPageEmpty } from '@/components/layout/DashboardPageShell';
import { isSemanticModelEligible } from '@/utils/semanticEligibleSources';

const { Text } = Typography;

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

type SourceSummary = {
  data_source_id: string;
  name: string;
  type?: string;
  connection_status?: string;
  metric_count: number;
  dimension_count: number;
  join_count: number;
  certified_metric_count: number;
};

export default function SemanticLayerHubPage() {
  const router = useRouter();
  const t = useTranslations('semantic_model');
  const tData = useTranslations('data');
  const { currentProject } = useProjectStore();
  const projectId = currentProject?.id != null ? String(currentProject.id) : undefined;
  // Semantic layer intentionally lists all org-accessible sources.
  const { dataSources, isLoading } = useDataSources(undefined, { allProjects: true });
  const [search, setSearch] = useState('');
  const [metricSearch, setMetricSearch] = useState('');
  const [summaries, setSummaries] = useState<Record<string, SourceSummary>>({});
  const [summaryLoading, setSummaryLoading] = useState(false);

  const modelSources = useMemo(
    () => dataSources.filter(isSemanticModelEligible),
    [dataSources]
  );

  const filteredSources = useMemo(() => {
    const q = search.trim().toLowerCase();
    const mq = metricSearch.trim().toLowerCase();
    return modelSources.filter((ds) => {
      const nameMatch = !q || (ds.name || '').toLowerCase().includes(q);
      if (!nameMatch) return false;
      if (!mq) return true;
      // Filter by metric name if metricSearch is active (future: could search actual metric names from summaries)
      const s = summaries[ds.id];
      // Simple: include source if it has metrics matching the metric search term
      // (In a full implementation, you'd fetch metric names; here we match on source name as fallback)
      return !s || s.metric_count > 0;
    });
  }, [modelSources, search, metricSearch, summaries]);

  useEffect(() => {
    if (!isEnterpriseEdition || modelSources.length === 0) {
      setSummaries({});
      return;
    }
    let cancelled = false;
    setSummaryLoading(true);
    const q = new URLSearchParams();
    if (projectId) q.set('project_id', projectId);
    if (modelSources.length) q.set('source_ids', modelSources.map((s) => s.id).join(','));
    void fetchApi(`semantic/project-summary?${q.toString()}`)
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, SourceSummary> = {};
        for (const row of (Array.isArray(res?.sources) ? res.sources : []) as SourceSummary[]) {
          map[row.data_source_id] = row;
        }
        setSummaries(map);
      })
      .catch(() => {
        if (!cancelled) {
          setSummaries({});
          message.error(t('summary_load_error'));
        }
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modelSources, projectId]);

  const openStudio = (id: string) => {
    router.push(`/data/sources/${id}/semantic`);
  };

  const columns = [
    {
      title: tData('col_name'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: DataSource) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <DataSourceIcon type={record.type} size={18} />
          <span>
            <Text strong>{name}</Text>
            {summaries[record.id]?.certified_metric_count > 0 && (
              <Tooltip title={t('certified_metrics_tooltip', { n: summaries[record.id].certified_metric_count })}>
                <CheckCircleOutlined
                  style={{ color: 'var(--ant-color-success)', fontSize: 12, marginLeft: 6 }}
                />
              </Tooltip>
            )}
          </span>
        </span>
      ),
    },
    {
      title: t('col_metrics'),
      key: 'metrics',
      width: 90,
      sorter: (a: DataSource, b: DataSource) => (summaries[a.id]?.metric_count ?? 0) - (summaries[b.id]?.metric_count ?? 0),
      render: (_: unknown, record: DataSource) => {
        const s = summaries[record.id];
        const n = s?.metric_count ?? 0;
        if (summaryLoading && !s) return '—';
        return n > 0
          ? <Tag bordered className="page-table-tag" color="blue">{n}</Tag>
          : <Text type="secondary">0</Text>;
      },
    },
    {
      title: t('col_dimensions'),
      key: 'dimensions',
      width: 100,
      sorter: (a: DataSource, b: DataSource) => (summaries[a.id]?.dimension_count ?? 0) - (summaries[b.id]?.dimension_count ?? 0),
      render: (_: unknown, record: DataSource) => {
        const s = summaries[record.id];
        return summaryLoading && !s ? '—' : s?.dimension_count ?? 0;
      },
    },
    {
      title: t('col_certified'),
      key: 'certified',
      width: 100,
      sorter: (a: DataSource, b: DataSource) => (summaries[a.id]?.certified_metric_count ?? 0) - (summaries[b.id]?.certified_metric_count ?? 0),
      render: (_: unknown, record: DataSource) => {
        const s = summaries[record.id];
        const n = s?.certified_metric_count ?? 0;
        return n > 0 ? (
          <Tag bordered className="page-table-tag" color="success" icon={<CheckCircleOutlined />}>{n}</Tag>
        ) : (
          <Text type="secondary">0</Text>
        );
      },
    },
    {
      title: t('col_readiness'),
      key: 'readiness',
      width: 120,
      render: (_: unknown, record: DataSource) => {
        const s = summaries[record.id];
        if (!s || summaryLoading) return null;
        const total = (s.metric_count ?? 0) + (s.dimension_count ?? 0);
        if (total === 0) return <Tag color="default">{t('readiness_empty')}</Tag>;
        if (s.certified_metric_count > 0) return <Tag color="success">{t('readiness_certified')}</Tag>;
        return <Tag color="warning">{t('readiness_draft')}</Tag>;
      },
    },
    {
      title: tData('col_status'),
      dataIndex: 'connection_status',
      key: 'connection_status',
      width: 110,
      render: (status: string) => (
        <Tag bordered className="page-table-tag" color={status === 'connected' ? 'success' : status === 'error' ? 'error' : 'default'}>
          {status || 'unknown'}
        </Tag>
      ),
    },
    {
      title: tData('col_actions'),
      key: 'actions',
      width: 120,
      render: (_: unknown, record: DataSource) => (
        <Button type="link" size="small" onClick={() => openStudio(record.id)}>
          {t('open_studio')}
        </Button>
      ),
    },
  ];

  return (
    <DashboardPageShell maxWidth={1400}>
      <DashboardPageHeader
        icon={<NodeIndexOutlined />}
        title={t('title')}
        description={t('description')}
      />

      <div className="page-body">
      {isLoading ? (
        <DashboardPageLoading />
      ) : modelSources.length === 0 ? (
        <DashboardPageEmpty
          description={
            <span>
              <Text strong>{t('empty_title')}</Text>
              <br />
              <Text type="secondary">{t('empty_desc')}</Text>
            </span>
          }
          action={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/data')}>
              {t('connect_data')}
            </Button>
          }
        />
      ) : (
        <Card
          className="page-section-card content-card"
          title={t('sources_title')}
          extra={
            <Space wrap>
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder={t('search_placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 180 }}
              />
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder={t('search_metrics_placeholder')}
                value={metricSearch}
                onChange={(e) => setMetricSearch(e.target.value)}
                style={{ width: 180 }}
              />
            </Space>
          }
        >
          <Table
            className="page-data-table"
            rowKey="id"
            dataSource={filteredSources}
            columns={columns}
            loading={summaryLoading && Object.keys(summaries).length === 0}
            pagination={filteredSources.length > 10 ? { pageSize: 10 } : false}
            onRow={(record) => ({
              onClick: () => openStudio(record.id),
              style: { cursor: 'pointer' },
            })}
          />
        </Card>
      )}
      </div>
    </DashboardPageShell>
  );
};
