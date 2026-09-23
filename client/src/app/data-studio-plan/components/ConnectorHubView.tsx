'use client';

import React, { useState } from 'react';
import {
  Card,
  Table,
  Tag,
  Typography,
  Button,
  Space,
  Row,
  Col,
  Statistic,
  Badge,
  Input,
  Select,
  Segmented,
  Switch,
  Drawer,
  Alert,
  Tooltip,
  Modal,
  message,
} from 'antd';
import {
  PlusOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  SyncOutlined,
  DatabaseOutlined,
  CloudUploadOutlined,
  ArrowRightOutlined,
  SettingOutlined,
  SearchOutlined,
  FilterOutlined,
  PlayCircleOutlined,
  WarningFilled,
  ToolOutlined,
  HistoryOutlined,
  ApartmentOutlined,
  ExclamationCircleFilled,
  InfoCircleOutlined,
  ReloadOutlined,
  CheckOutlined,
} from '@ant-design/icons';

import { AddConnectionModal } from './AddConnectionModal';

const { Title, Text, Paragraph } = Typography;

export function ConnectorHubView() {
  const [hubTab, setHubTab] = useState<'connections' | 'sources' | 'destinations'>('connections');
  const [timeWindow, setTimeWindow] = useState<'6h' | '24h' | '7d' | '30d'>('7d');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedConnection, setSelectedConnection] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [streamModalOpen, setStreamModalOpen] = useState<boolean>(false);
  const [addConnModalOpen, setAddConnModalOpen] = useState<boolean>(false);
  const [remediating, setRemediating] = useState<boolean>(false);

  // Connection data mimicking user's Airbyte screenshot + enterprise additions
  const [connections, setConnections] = useState([
    {
      key: '1',
      id: 'conn-pg-s3',
      name: 'Postgres → S3',
      status: 'failed',
      errorMessage: 'Connection timed out during streaming replication slot (socket closed after 30000ms)',
      source: {
        name: 'Postgres',
        type: 'PostgreSQL RDS',
        iconColor: '#336791',
        streams: 4,
        host: 'db-prod.us-east-1.rds.amazonaws.com:5432/crm',
      },
      destination: {
        name: 'S3',
        type: 'AWS S3 Parquet Landing',
        iconColor: '#e05243',
        bucket: 's3://aicser-lake-bronze/parquet/',
      },
      frequency: '24 hours',
      tags: ['prod', 'raw_bronze'],
      lastSync: '22 hours ago',
      lastSyncDetail: 'Failed (0 rows committed, 14,200 pending in WAL)',
      qualityScore: 'N/A (Failed prior to ingestion)',
      quarantinedCount: 0,
      enabled: true,
      syncHistory: [
        { date: 'Fri, Sep 4', status: 'failed', count: 1 },
        { date: 'Sat, Sep 5', status: 'failed', count: 1 },
        { date: 'Sun, Sep 6', status: 'failed', count: 1 },
        { date: 'Mon, Sep 7', status: 'failed', count: 1 },
        { date: 'Tue, Sep 8', status: 'failed', count: 1 },
        { date: 'Wed, Sep 9', status: 'failed', count: 1 },
        { date: 'Thu, Sep 10', status: 'failed', count: 1 },
        { date: 'Fri, Sep 11', status: 'failed', count: 1 },
      ],
    },
    {
      key: '2',
      id: 'conn-pg-iceberg',
      name: 'Postgres RDS → Apache Iceberg (Silver Conformed)',
      status: 'healthy',
      errorMessage: null,
      source: {
        name: 'Postgres',
        type: 'PostgreSQL RDS',
        iconColor: '#336791',
        streams: 4,
        host: 'db-prod.us-east-1.rds.amazonaws.com:5432/crm',
      },
      destination: {
        name: 'Apache Iceberg',
        type: 'Polaris REST Lakehouse',
        iconColor: '#00c2cb',
        bucket: 's3://aicser-lakehouse/silver_conformed_crm',
      },
      frequency: '15 minutes (CDC)',
      tags: ['prod', 'silver_conformed', 'quality_gated'],
      lastSync: '12 minutes ago',
      lastSyncDetail: 'Success (48,498 rows upserted in 1.84s)',
      qualityScore: '99.95% Pass',
      quarantinedCount: 22,
      enabled: true,
      syncHistory: [
        { date: 'Fri, Sep 4', status: 'success', count: 96 },
        { date: 'Sat, Sep 5', status: 'success', count: 96 },
        { date: 'Sun, Sep 6', status: 'success', count: 96 },
        { date: 'Mon, Sep 7', status: 'success', count: 96 },
        { date: 'Tue, Sep 8', status: 'success', count: 96 },
        { date: 'Wed, Sep 9', status: 'success', count: 96 },
        { date: 'Thu, Sep 10', status: 'success', count: 96 },
        { date: 'Fri, Sep 11', status: 'success', count: 48 },
      ],
    },
    {
      key: '3',
      id: 'conn-stripe-iceberg',
      name: 'Stripe API → Bronze Raw Payments',
      status: 'healthy',
      errorMessage: null,
      source: {
        name: 'Stripe',
        type: 'Stripe Cloud Webhooks & REST',
        iconColor: '#635bff',
        streams: 3,
        host: 'api.stripe.com/v1',
      },
      destination: {
        name: 'Apache Iceberg',
        type: 'Polaris REST Lakehouse',
        iconColor: '#00c2cb',
        bucket: 's3://aicser-lakehouse/bronze_raw_payments',
      },
      frequency: 'Hourly',
      tags: ['finance', 'webhooks'],
      lastSync: 'Just now',
      lastSyncDetail: 'Success (52,100 events ingested)',
      qualityScore: '100% Pass',
      quarantinedCount: 0,
      enabled: true,
      syncHistory: [
        { date: 'Fri, Sep 4', status: 'success', count: 24 },
        { date: 'Sat, Sep 5', status: 'success', count: 24 },
        { date: 'Sun, Sep 6', status: 'success', count: 24 },
        { date: 'Mon, Sep 7', status: 'success', count: 24 },
        { date: 'Tue, Sep 8', status: 'success', count: 24 },
        { date: 'Wed, Sep 9', status: 'success', count: 24 },
        { date: 'Thu, Sep 10', status: 'success', count: 24 },
        { date: 'Fri, Sep 11', status: 'success', count: 12 },
      ],
    },
    {
      key: '4',
      id: 'conn-gold-snowflake',
      name: 'Gold Financial Marts → Snowflake (Reverse-ETL)',
      status: 'syncing',
      errorMessage: null,
      source: {
        name: 'Apache Iceberg',
        type: 'Curated Gold Marts',
        iconColor: '#00c2cb',
        streams: 2,
        host: 'lakehouse.aicser.internal',
      },
      destination: {
        name: 'Snowflake',
        type: 'Snowflake Enterprise DW',
        iconColor: '#29b5e8',
        bucket: 'ANALYTICS.FINANCE.MRR_SUMMARY',
      },
      frequency: '6 hours',
      tags: ['reverse_etl', 'snowflake', 'cfo_dashboard'],
      lastSync: 'Syncing right now...',
      lastSyncDetail: 'Streaming 360 dimensional aggregates to Snowflake',
      qualityScore: '100% Certified',
      quarantinedCount: 0,
      enabled: true,
      syncHistory: [
        { date: 'Fri, Sep 4', status: 'success', count: 4 },
        { date: 'Sat, Sep 5', status: 'success', count: 4 },
        { date: 'Sun, Sep 6', status: 'success', count: 4 },
        { date: 'Mon, Sep 7', status: 'success', count: 4 },
        { date: 'Tue, Sep 8', status: 'success', count: 4 },
        { date: 'Wed, Sep 9', status: 'success', count: 4 },
        { date: 'Thu, Sep 10', status: 'success', count: 4 },
        { date: 'Fri, Sep 11', status: 'syncing', count: 2 },
      ],
    },
    {
      key: '5',
      id: 'conn-salesforce-bq',
      name: 'Salesforce CRM → BigQuery Marketing Mart',
      status: 'healthy',
      errorMessage: null,
      source: {
        name: 'Salesforce',
        type: 'Salesforce REST v58',
        iconColor: '#00a1e0',
        streams: 6,
        host: 'na142.salesforce.com',
      },
      destination: {
        name: 'BigQuery',
        type: 'Google Cloud BigQuery',
        iconColor: '#4285f4',
        bucket: 'gcp-corp-data:marketing_lake',
      },
      frequency: '12 hours',
      tags: ['marketing', 'crm'],
      lastSync: '2 hours ago',
      lastSyncDetail: 'Success (8,420 opportunities synced)',
      qualityScore: '99.8% Pass',
      quarantinedCount: 4,
      enabled: false,
      syncHistory: [
        { date: 'Fri, Sep 4', status: 'success', count: 2 },
        { date: 'Sat, Sep 5', status: 'success', count: 2 },
        { date: 'Sun, Sep 6', status: 'success', count: 2 },
        { date: 'Mon, Sep 7', status: 'success', count: 2 },
        { date: 'Tue, Sep 8', status: 'success', count: 2 },
        { date: 'Wed, Sep 9', status: 'success', count: 2 },
        { date: 'Thu, Sep 10', status: 'success', count: 2 },
        { date: 'Fri, Sep 11', status: 'success', count: 1 },
      ],
    },
  ]);

  // Handle auto-healing simulation for Postgres -> S3
  const handleAutoHeal = () => {
    setRemediating(true);
    message.loading({ content: 'Testing PostgreSQL RDS connectivity and restarting WAL replication slot...', key: 'heal' });
    setTimeout(() => {
      setConnections((prev) =>
        prev.map((c) =>
          c.id === 'conn-pg-s3'
            ? {
                ...c,
                status: 'healthy',
                errorMessage: null,
                lastSync: 'Just now (Auto-Healed)',
                lastSyncDetail: 'Success (14,200 backlog rows synced to s3://aicser-lake-bronze/)',
                syncHistory: c.syncHistory.map((h, i) => (i === c.syncHistory.length - 1 ? { ...h, status: 'success' } : h)),
              }
            : c
        )
      );
      setRemediating(false);
      setDrawerOpen(false);
      message.success({ content: 'Connection auto-healed! Streaming replication slot resumed. 14,200 rows committed.', key: 'heal', duration: 4 });
    }, 2200);
  };

  const handleSyncNow = (connId: string) => {
    message.loading({ content: `Triggering sync for ${connId}...`, key: 'sync' });
    setTimeout(() => {
      message.success({ content: `Sync completed successfully!`, key: 'sync' });
    }, 1500);
  };

  const failedCount = connections.filter((c) => c.status === 'failed').length;
  const healthyCount = connections.filter((c) => c.status === 'healthy').length;
  const syncingCount = connections.filter((c) => c.status === 'syncing').length;

  const filteredConnections = connections.filter((c) => {
    if (statusFilter === 'failed' && c.status !== 'failed') return false;
    if (statusFilter === 'healthy' && c.status !== 'healthy') return false;
    if (statusFilter === 'syncing' && c.status !== 'syncing') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.source.name.toLowerCase().includes(q) ||
        c.destination.name.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top Value Banner (Comparing Airbyte with Aicser Medallion) */}
      <Alert
        type="info"
        showIcon
        icon={<ApartmentOutlined style={{ fontSize: 18 }} />}
        message={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span>
              <strong>Airbyte Connection Parity + Aicser Medallion Superpower:</strong> While Airbyte stops at raw source-to-destination replication, Aicser embeds data quality gates, visual data prep, Iceberg catalog, and Reverse-ETL directly into the connection lifecycle.
            </span>
            <Tag color="purple">Enterprise Hybrid Engine</Tag>
          </div>
        }
      />

      {/* Sub-Tabs: Connections, Sources, Destinations */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Segmented
          size="middle"
          value={hubTab}
          onChange={(val) => setHubTab(val as any)}
          options={[
            {
              label: (
                <Space size={6}>
                  <SyncOutlined />
                  <span>Connections ({connections.length})</span>
                  {failedCount > 0 && <Badge count={`${failedCount} failed`} style={{ backgroundColor: '#ef4444' }} />}
                </Space>
              ),
              value: 'connections',
            },
            {
              label: (
                <Space size={6}>
                  <DatabaseOutlined />
                  <span>Source Connectors (4)</span>
                </Space>
              ),
              value: 'sources',
            },
            {
              label: (
                <Space size={6}>
                  <CloudUploadOutlined />
                  <span>Destinations & Reverse-ETL (4)</span>
                </Space>
              ),
              value: 'destinations',
            },
          ]}
        />

        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            style={{ background: '#00c2cb', borderColor: '#00c2cb', fontWeight: 600 }}
            onClick={() => setAddConnModalOpen(true)}
          >
            New connection
          </Button>
        </Space>
      </div>

      {hubTab === 'connections' ? (
        <>
          {/* Main Airbyte-style Connections Header & Card */}
          <Card
            style={{
              borderRadius: 10,
              background: 'var(--ant-color-bg-container, #ffffff)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
            styles={{ body: { padding: '20px 24px' } }}
          >
            {/* Title Row with Failure Indicator */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <Title level={4} style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>
                  Connections
                </Title>
                <div style={{ marginTop: 2, fontSize: 12 }}>
                  {failedCount > 0 ? (
                    <Text type="danger" strong style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <CloseCircleFilled /> {failedCount} failed connection needs attention
                    </Text>
                  ) : (
                    <Text style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <CheckCircleFilled /> All connections healthy & syncing on schedule
                    </Text>
                  )}
                </div>
              </div>

              {/* Fast Stats */}
              <Space size={20}>
                <div>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>TOTAL CONNECTIONS</Text>
                  <Text strong style={{ fontSize: 16 }}>{connections.length}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>FAILED</Text>
                  <Text strong style={{ fontSize: 16, color: failedCount > 0 ? '#ef4444' : '#64748b' }}>
                    {failedCount}
                  </Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>HEALTHY</Text>
                  <Text strong style={{ fontSize: 16, color: '#10b981' }}>{healthyCount}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>SYNCING</Text>
                  <Text strong style={{ fontSize: 16, color: '#3b82f6' }}>{syncingCount}</Text>
                </div>
              </Space>
            </div>

            {/* Filter & Search Bar matching Airbyte */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                background: 'var(--ant-color-fill-quaternary, #f8fafc)',
                borderRadius: 8,
                marginBottom: 16,
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 280 }}>
                <Input
                  prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                  placeholder="Search connections, tables or hosts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  allowClear
                  style={{ maxWidth: 280, borderRadius: 6 }}
                  size="small"
                />

                <Select
                  size="small"
                  defaultValue="all"
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v)}
                  style={{ width: 130 }}
                  options={[
                    { label: 'All statuses', value: 'all' },
                    { label: 'Failed (1)', value: 'failed' },
                    { label: 'Healthy (3)', value: 'healthy' },
                    { label: 'Syncing (1)', value: 'syncing' },
                  ]}
                />

                <Select
                  size="small"
                  defaultValue="all"
                  style={{ width: 130 }}
                  options={[
                    { label: 'All sources', value: 'all' },
                    { label: 'PostgreSQL RDS', value: 'pg' },
                    { label: 'Stripe API', value: 'stripe' },
                    { label: 'ClickHouse', value: 'ch' },
                  ]}
                />

                <Select
                  size="small"
                  defaultValue="all"
                  style={{ width: 140 }}
                  options={[
                    { label: 'All destinations', value: 'all' },
                    { label: 'S3 Parquet', value: 's3' },
                    { label: 'Apache Iceberg', value: 'iceberg' },
                    { label: 'Snowflake DW', value: 'snowflake' },
                  ]}
                />

                <Select
                  size="small"
                  defaultValue="all"
                  style={{ width: 100 }}
                  options={[
                    { label: 'Tags', value: 'all' },
                    { label: 'prod', value: 'prod' },
                    { label: 'finance', value: 'finance' },
                    { label: 'marketing', value: 'marketing' },
                  ]}
                />
              </div>

              {/* Time Window Selector (6h, 24h, 7d, 30d) like in screenshot */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Segmented
                  size="small"
                  value={timeWindow}
                  onChange={(val) => setTimeWindow(val as any)}
                  options={[
                    { label: '6h', value: '6h' },
                    { label: '24h', value: '24h' },
                    { label: '7d', value: '7d' },
                    { label: '30d', value: '30d' },
                  ]}
                />
              </div>
            </div>

            {/* Sync History Sparkline / Timeline Bar Chart (Faithful recreation of Airbyte's chart) */}
            <div
              style={{
                border: '1px solid var(--ant-color-border-secondary, #e2e8f0)',
                borderRadius: 8,
                padding: '14px 20px',
                marginBottom: 20,
                background: 'var(--ant-color-bg-layout, #ffffff)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#64748b' }}>
                  Execution Timeline & Failure Trace ({timeWindow} Window)
                </span>
                <Space size={12}>
                  <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} />
                    <span>Failed Sync</span>
                  </span>
                  <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: '#10b981', display: 'inline-block' }} />
                    <span>Successful Sync</span>
                  </span>
                </Space>
              </div>

              {/* Visual Grid representing Airbyte's daily execution timeline */}
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: 75, paddingTop: 10 }}>
                {[
                  { day: 'Fri, Sep 4', failed: 1, success: 4, hasFailed: true },
                  { day: 'Sat, Sep 5', failed: 1, success: 4, hasFailed: true },
                  { day: 'Sun, Sep 6', failed: 1, success: 4, hasFailed: true },
                  { day: 'Mon, Sep 7', failed: 1, success: 4, hasFailed: true },
                  { day: 'Tue, Sep 8', failed: 1, success: 4, hasFailed: true },
                  { day: 'Wed, Sep 9', failed: 1, success: 4, hasFailed: true },
                  { day: 'Thu, Sep 10', failed: 1, success: 4, hasFailed: true },
                  { day: 'Fri, Sep 11', failed: failedCount > 0 ? 1 : 0, success: 5, hasFailed: failedCount > 0 },
                ].map((item, idx) => (
                  <Tooltip
                    key={idx}
                    title={
                      <div>
                        <div style={{ fontWeight: 700 }}>{item.day}</div>
                        <div>Failed syncs: {item.failed} ({item.failed > 0 ? 'Postgres → S3' : 'None'})</div>
                        <div>Successful syncs: {item.success}</div>
                        <div>Throughput: 14.2M rows</div>
                      </div>
                    }
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                        flex: 1,
                      }}
                    >
                      <div
                        style={{
                          width: '80%',
                          height: 38,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'flex-end',
                          alignItems: 'center',
                        }}
                      >
                        {item.hasFailed && (
                          <div
                            style={{
                              width: 14,
                              height: 10,
                              borderRadius: 2,
                              background: '#ef4444',
                              marginBottom: 2,
                            }}
                          />
                        )}
                        <div
                          style={{
                            width: 14,
                            height: 22,
                            borderRadius: 2,
                            background: '#10b981',
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 11, color: '#64748b' }}>{item.day}</span>
                    </div>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* Connections Table (Replicating Airbyte's columns + Aicser Data Quality) */}
            <Table
              dataSource={filteredConnections}
              pagination={false}
              size="middle"
              rowKey="key"
              columns={[
                {
                  title: 'NAME',
                  dataIndex: 'name',
                  key: 'name',
                  render: (name: string, r: any) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {r.status === 'failed' ? (
                        <Tooltip title={`Failed: ${r.errorMessage}`}>
                          <CloseCircleFilled style={{ color: '#ef4444', fontSize: 16 }} />
                        </Tooltip>
                      ) : r.status === 'syncing' ? (
                        <SyncOutlined spin style={{ color: '#3b82f6', fontSize: 16 }} />
                      ) : (
                        <CheckCircleFilled style={{ color: '#10b981', fontSize: 16 }} />
                      )}

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Text
                            strong
                            style={{
                              fontSize: 13,
                              cursor: 'pointer',
                              color: r.status === 'failed' ? '#ef4444' : 'inherit',
                            }}
                            onClick={() => {
                              setSelectedConnection(r);
                              setDrawerOpen(true);
                            }}
                          >
                            {name}
                          </Text>
                          {r.status === 'failed' && (
                            <Tag color="error" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                              Failed
                            </Tag>
                          )}
                        </div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          ID: {r.id}
                        </Text>
                      </div>
                    </div>
                  ),
                },
                {
                  title: 'SOURCE NAME',
                  key: 'source',
                  render: (_: any, r: any) => (
                    <Space size={8}>
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          background: '#f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: r.source.iconColor,
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        <DatabaseOutlined />
                      </div>
                      <div>
                        <Text strong style={{ fontSize: 12 }}>{r.source.name}</Text>
                        <div>
                          <Tag
                            color="blue"
                            style={{ fontSize: 10, cursor: 'pointer' }}
                            onClick={() => {
                              setSelectedConnection(r);
                              setStreamModalOpen(true);
                            }}
                          >
                            {r.source.streams} streams
                          </Tag>
                        </div>
                      </div>
                    </Space>
                  ),
                },
                {
                  title: 'DESTINATION NAME',
                  key: 'destination',
                  render: (_: any, r: any) => (
                    <Space size={8}>
                      <div
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          background: '#f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: r.destination.iconColor,
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        <CloudUploadOutlined />
                      </div>
                      <div>
                        <Text strong style={{ fontSize: 12 }}>{r.destination.name}</Text>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{r.destination.type}</div>
                      </div>
                    </Space>
                  ),
                },
                {
                  title: 'FREQUENCY',
                  dataIndex: 'frequency',
                  key: 'frequency',
                  render: (freq: string) => <Tag color="geekblue">{freq}</Tag>,
                },
                {
                  title: 'TAGS',
                  dataIndex: 'tags',
                  key: 'tags',
                  render: (tags: string[]) => (
                    <Space size={4} wrap>
                      {tags.map((t, idx) => (
                        <Tag key={idx} style={{ fontSize: 10, borderRadius: 4 }}>{t}</Tag>
                      ))}
                    </Space>
                  ),
                },
                {
                  title: 'DATA QUALITY (AICSER)',
                  key: 'quality',
                  render: (_: any, r: any) => (
                    <div>
                      {r.status === 'failed' ? (
                        <Text type="secondary" style={{ fontSize: 11 }}>Stream Blocked</Text>
                      ) : (
                        <div>
                          <Badge status={r.quarantinedCount > 0 ? 'warning' : 'success'} text={r.qualityScore} />
                          {r.quarantinedCount > 0 && (
                            <div style={{ fontSize: 10, color: '#f59e0b' }}>
                              {r.quarantinedCount} in quarantine DLQ
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  title: 'LAST SYNC',
                  key: 'lastSync',
                  render: (_: any, r: any) => (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: r.status === 'failed' ? '#ef4444' : 'inherit' }}>
                        {r.lastSync}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{r.lastSyncDetail}</div>
                    </div>
                  ),
                },
                {
                  title: 'ENABLED',
                  dataIndex: 'enabled',
                  key: 'enabled',
                  render: (enabled: boolean, r: any) => (
                    <Switch
                      size="small"
                      checked={enabled}
                      onChange={(checked) => {
                        setConnections((prev) =>
                          prev.map((c) => (c.id === r.id ? { ...c, enabled: checked } : c))
                        );
                        message.info(`${r.name} sync schedule ${checked ? 'enabled' : 'paused'}`);
                      }}
                    />
                  ),
                },
                {
                  title: 'ACTIONS',
                  key: 'actions',
                  render: (_: any, r: any) => (
                    <Space size={4}>
                      {r.status === 'failed' ? (
                        <Button
                          size="small"
                          type="primary"
                          danger
                          icon={<ToolOutlined />}
                          onClick={() => {
                            setSelectedConnection(r);
                            setDrawerOpen(true);
                          }}
                        >
                          Diagnose
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          icon={<PlayCircleOutlined />}
                          onClick={() => handleSyncNow(r.id)}
                        >
                          Sync Now
                        </Button>
                      )}

                      <Button
                        size="small"
                        icon={<SettingOutlined />}
                        onClick={() => {
                          setSelectedConnection(r);
                          setDrawerOpen(true);
                        }}
                      />
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </>
      ) : hubTab === 'sources' ? (
        /* Inbound Sources Catalog */
        <Card title="Configured Source Connectors (Inbound Ingest)" style={{ borderRadius: 10 }}>
          <Table
            dataSource={[
              { key: '1', name: 'Production RDS Postgres', type: 'PostgreSQL 16', streams: '4 tables', status: 'Connected', host: 'db-prod.us-east-1.rds.amazonaws.com' },
              { key: '2', name: 'Stripe Webhooks & Events', type: 'Stripe API', streams: '3 streams', status: 'Connected', host: 'api.stripe.com' },
              { key: '3', name: 'Analytics ClickHouse Mart', type: 'ClickHouse Native', streams: '1 stream', status: 'Connected', host: 'ch-cluster.internal:9000' },
              { key: '4', name: 'Salesforce CRM Org', type: 'Salesforce REST', streams: '6 streams', status: 'Connected', host: 'na142.salesforce.com' },
            ]}
            pagination={false}
            columns={[
              { title: 'Source Name', dataIndex: 'name', key: 'name', render: (t) => <Text strong>{t}</Text> },
              { title: 'Connector Type', dataIndex: 'type', key: 'type', render: (t) => <Tag color="blue">{t}</Tag> },
              { title: 'Replicated Streams', dataIndex: 'streams', key: 'streams' },
              { title: 'Endpoint / Host', dataIndex: 'host', key: 'host' },
              { title: 'Status', dataIndex: 'status', key: 'status', render: (t) => <Badge status="success" text={t} /> },
              {
                title: 'Actions',
                key: 'actions',
                render: () => (
                  <Space>
                    <Button size="small">Test</Button>
                    <Button size="small" icon={<SettingOutlined />} />
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      ) : (
        /* Outbound Destinations Catalog */
        <Card title="Configured Destinations & Reverse-ETL Targets" style={{ borderRadius: 10 }}>
          <Table
            dataSource={[
              { key: '1', name: 'AWS S3 Parquet Landing', type: 'Object Storage (Bronze)', target: 's3://aicser-lake-bronze/', status: 'Connected' },
              { key: '2', name: 'Apache Iceberg Lakehouse', type: 'Polaris REST Catalog (Silver/Gold)', target: 'finance_prod.silver_crm', status: 'Connected' },
              { key: '3', name: 'Snowflake Enterprise DW', type: 'Reverse-ETL Snowflake Egress', target: 'ANALYTICS.FINANCE.MRR', status: 'Connected' },
              { key: '4', name: 'Google Cloud BigQuery', type: 'Reverse-ETL BigQuery Egress', target: 'marketing_lake.conversions', status: 'Connected' },
            ]}
            pagination={false}
            columns={[
              { title: 'Destination Target', dataIndex: 'name', key: 'name', render: (t) => <Text strong>{t}</Text> },
              { title: 'Engine Type', dataIndex: 'type', key: 'type', render: (t) => <Tag color="purple">{t}</Tag> },
              { title: 'Target URI / Dataset', dataIndex: 'target', key: 'target' },
              { title: 'Status', dataIndex: 'status', key: 'status', render: (t) => <Badge status="success" text={t} /> },
              {
                title: 'Actions',
                key: 'actions',
                render: () => (
                  <Space>
                    <Button size="small">Test Connectivity</Button>
                    <Button size="small" icon={<SettingOutlined />} />
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}

      {/* Airbyte-style Connection Diagnostic & Remediation Drawer */}
      <Drawer
        title={
          selectedConnection ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {selectedConnection.status === 'failed' ? (
                <CloseCircleFilled style={{ color: '#ef4444' }} />
              ) : (
                <CheckCircleFilled style={{ color: '#10b981' }} />
              )}
              <span>Connection: {selectedConnection.name}</span>
            </div>
          ) : (
            'Connection Details'
          )
        }
        placement="right"
        width={620}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {selectedConnection && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {selectedConnection.status === 'failed' ? (
              <Alert
                type="error"
                showIcon
                icon={<WarningFilled />}
                message="Critical Sync Incident Detected"
                description={
                  <div>
                    <Paragraph style={{ margin: '4px 0', fontSize: 13 }}>
                      <strong>Root Cause:</strong> {selectedConnection.errorMessage}
                    </Paragraph>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Occurred 22 hours ago on worker pod <code>airbyte-worker-pg-rds-7bc94</code>. S3 write channel was disconnected.
                    </Text>
                  </div>
                }
              />
            ) : (
              <Alert
                type="success"
                showIcon
                message="Connection Operating Normally"
                description="CDC microbatching active. 0 errors detected in last 100 runs."
              />
            )}

            {/* Quick Action Bar for Failures */}
            {selectedConnection.status === 'failed' && (
              <Card size="small" title="Automated Remediation Actions" style={{ borderRadius: 8 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Text strong>Auto-Heal & Resume from Watermark</Text>
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        Re-probes RDS WAL replication slot, refreshes TLS certificates, and retries the sync without dropping data.
                      </div>
                    </div>
                    <Button
                      type="primary"
                      style={{ background: '#10b981', borderColor: '#10b981' }}
                      loading={remediating}
                      onClick={handleAutoHeal}
                    >
                      Auto-Heal & Sync
                    </Button>
                  </div>

                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Text strong>Test DB Credentials & SSL</Text>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Verify read permissions on Postgres information_schema</div>
                    </div>
                    <Button size="small" onClick={() => message.success('PostgreSQL connection ping: 24ms (OK)')}>
                      Test Ping
                    </Button>
                  </div>
                </Space>
              </Card>
            )}

            {/* Properties Grid */}
            <Card size="small" title="Pipeline Properties" style={{ borderRadius: 8 }}>
              <Row gutter={[12, 12]}>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 11 }}>SOURCE ENDPOINT</Text>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{selectedConnection.source.host}</div>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 11 }}>DESTINATION TARGET</Text>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{selectedConnection.destination.bucket}</div>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 11 }}>SYNC FREQUENCY</Text>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{selectedConnection.frequency}</div>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 11 }}>DATA QUALITY STATUS</Text>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{selectedConnection.qualityScore}</div>
                </Col>
              </Row>
            </Card>

            {/* Stream List inside this connection */}
            <Card
              size="small"
              title={`Replicated Streams (${selectedConnection.source.streams})`}
              style={{ borderRadius: 8 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { table: 'orders', mode: 'Incremental Watermark (updated_at)', rows: '48,520 rows', status: selectedConnection.status === 'failed' ? 'Failed' : 'Synced' },
                  { table: 'customers', mode: 'Incremental Watermark (updated_at)', rows: '12,450 rows', status: selectedConnection.status === 'failed' ? 'Pending' : 'Synced' },
                  { table: 'payments', mode: 'CDC Log Stream', rows: '52,100 events', status: selectedConnection.status === 'failed' ? 'Pending' : 'Synced' },
                  { table: 'products', mode: 'Full Refresh Snapshot', rows: '840 rows', status: selectedConnection.status === 'failed' ? 'Pending' : 'Synced' },
                ].map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      background: '#f8fafc',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  >
                    <Space>
                      <DatabaseOutlined style={{ color: '#3b82f6' }} />
                      <Text strong>{s.table}</Text>
                      <Tag color="cyan" style={{ fontSize: 10 }}>{s.mode}</Tag>
                    </Space>
                    <Space>
                      <Text type="secondary" style={{ fontSize: 11 }}>{s.rows}</Text>
                      <Tag color={s.status === 'Failed' ? 'error' : s.status === 'Pending' ? 'orange' : 'success'}>
                        {s.status}
                      </Tag>
                    </Space>
                  </div>
                ))}
              </div>
            </Card>

            {/* Execution Logs */}
            <Card size="small" title="Airbyte Worker Execution Logs" style={{ borderRadius: 8 }}>
              <div
                style={{
                  background: '#1e1e1e',
                  color: '#94a3b8',
                  padding: 12,
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 11,
                  lineHeight: 1.6,
                  maxHeight: 160,
                  overflowY: 'auto',
                }}
              >
                {selectedConnection.status === 'failed' ? (
                  <>
                    <div style={{ color: '#38bdf8' }}>[INFO] 2026-09-10 18:45:00 - Starting sync job for connection conn-pg-s3</div>
                    <div style={{ color: '#38bdf8' }}>[INFO] 2026-09-10 18:45:01 - Introspecting Postgres schemas... 4 tables found.</div>
                    <div style={{ color: '#38bdf8' }}>[INFO] 2026-09-10 18:45:02 - Reading table &apos;orders&apos; from cursor &apos;2026-09-10 18:30:00&apos;</div>
                    <div style={{ color: '#f87171' }}>[ERROR] 2026-09-10 18:45:32 - SocketTimeoutException: Read timed out after 30000ms</div>
                    <div style={{ color: '#f87171' }}>[FATAL] 2026-09-10 18:45:32 - Connection pool dropped by remote host. 0 rows committed to S3.</div>
                    <div style={{ color: '#fbbf24' }}>[WARN] 2026-09-10 18:45:32 - WAL sequence retained. No data loss occurred. Safe to retry.</div>
                  </>
                ) : (
                  <>
                    <div style={{ color: '#38bdf8' }}>[INFO] Starting incremental sync for connection {selectedConnection.id}</div>
                    <div style={{ color: '#38bdf8' }}>[INFO] Stream &apos;orders&apos;: committed 48,498 rows to target</div>
                    <div style={{ color: '#4ade80' }}>[SUCCESS] Sync completed with 0 errors. Quality score: 99.95%</div>
                  </>
                )}
              </div>
            </Card>
          </div>
        )}
      </Drawer>

      {/* Multi-Stream Configuration Modal */}
      <Modal
        title={selectedConnection ? `Replication Streams: ${selectedConnection.name}` : 'Stream Configuration'}
        open={streamModalOpen}
        onCancel={() => setStreamModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setStreamModalOpen(false)}>
            Close
          </Button>,
        ]}
        width={700}
      >
        <Paragraph>
          Each connection in Aicser can synchronize multiple streams / tables in parallel with custom replication modes, primary keys, and cursor fields.
        </Paragraph>
        <Table
          dataSource={[
            { key: '1', stream: 'orders', syncMode: 'Incremental | Deduped', cursor: 'updated_at', pk: 'order_id', rows: '48,520' },
            { key: '2', stream: 'customers', syncMode: 'Incremental | Deduped', cursor: 'updated_at', pk: 'customer_id', rows: '12,450' },
            { key: '3', stream: 'payments', syncMode: 'CDC | Append', cursor: 'wal_lsn', pk: 'payment_id', rows: '52,100' },
            { key: '4', stream: 'products', syncMode: 'Full Refresh | Overwrite', cursor: 'None', pk: 'product_id', rows: '840' },
          ]}
          pagination={false}
          size="small"
          columns={[
            { title: 'Stream / Table', dataIndex: 'stream', key: 'stream', render: (t) => <Text strong>{t}</Text> },
            { title: 'Sync Mode', dataIndex: 'syncMode', key: 'syncMode', render: (m) => <Tag color="blue">{m}</Tag> },
            { title: 'Cursor Field', dataIndex: 'cursor', key: 'cursor' },
            { title: 'Primary Key', dataIndex: 'pk', key: 'pk' },
            { title: 'Records Emitted', dataIndex: 'rows', key: 'rows' },
          ]}
        />
      </Modal>

      {/* New Connection Multi-Step Wizard Modal */}
      <AddConnectionModal
        open={addConnModalOpen}
        onCancel={() => setAddConnModalOpen(false)}
        onSave={(newConn) => {
          setConnections((prev) => [newConn, ...prev]);
          setAddConnModalOpen(false);
        }}
      />
    </div>
  );
}
