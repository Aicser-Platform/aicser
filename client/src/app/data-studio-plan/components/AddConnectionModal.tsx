'use client';

import React, { useState } from 'react';
import {
  Modal,
  Steps,
  Card,
  Button,
  Radio,
  Input,
  Select,
  Table,
  Tag,
  Typography,
  Space,
  Row,
  Col,
  Badge,
  Switch,
  Checkbox,
  Tooltip,
  message,
  Divider,
  Alert,
} from 'antd';
import {
  DatabaseOutlined,
  CloudUploadOutlined,
  SyncOutlined,
  CheckCircleFilled,
  ArrowRightOutlined,
  SettingOutlined,
  SearchOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  TableOutlined,
  KeyOutlined,
  CheckOutlined,
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

export interface NewConnectionFormValues {
  name: string;
  sourceKey: string;
  destinationKey: string;
  frequency: string;
  syncStreams: Array<{
    stream: string;
    mode: string;
    cursor: string;
    pk: string;
  }>;
  schemaDrift: string;
  enableQualityGate: boolean;
  quarantineDLQ: boolean;
  tags: string[];
}

interface AddConnectionModalProps {
  open: boolean;
  onCancel: () => void;
  onSave: (connection: any) => void;
}

export function AddConnectionModal({ open, onCancel, onSave }: AddConnectionModalProps) {
  const [currentStep, setCurrentStep] = useState(0);

  // Available Sources
  const availableSources = [
    {
      key: 'pg-prod',
      name: 'Production RDS Postgres',
      type: 'PostgreSQL 16',
      iconColor: '#336791',
      streamsCount: 4,
      host: 'db-prod.us-east-1.rds.amazonaws.com:5432/crm',
      description: 'OLTP CRM core database containing orders, customers, payments, products.',
    },
    {
      key: 'stripe-api',
      name: 'Stripe API & Webhooks',
      type: 'Stripe Cloud REST',
      iconColor: '#635bff',
      streamsCount: 3,
      host: 'api.stripe.com/v1',
      description: 'Payment transactions, customer subscriptions, disputes, invoice items.',
    },
    {
      key: 'ch-telemetry',
      name: 'Analytics ClickHouse Mart',
      type: 'ClickHouse Native',
      iconColor: '#ffcc00',
      streamsCount: 1,
      host: 'ch-cluster.internal:9000',
      description: 'High-throughput event logs and clickstream telemetry.',
    },
    {
      key: 'salesforce-crm',
      name: 'Salesforce Enterprise CRM',
      type: 'Salesforce REST v58',
      iconColor: '#00a1e0',
      streamsCount: 6,
      host: 'na142.salesforce.com',
      description: 'Sales pipeline opportunities, accounts, contacts, leads.',
    },
  ];

  // Available Destinations
  const availableDestinations = [
    {
      key: 's3-bronze',
      name: 'AWS S3 Parquet Landing (Bronze)',
      type: 'Object Storage',
      iconColor: '#e05243',
      bucket: 's3://aicser-lake-bronze/parquet/',
      description: 'Raw immutable Bronze landing zone partitioned by ingestion microbatches.',
    },
    {
      key: 'iceberg-lake',
      name: 'Apache Iceberg Lakehouse (Silver/Gold)',
      type: 'Polaris REST Catalog',
      iconColor: '#00c2cb',
      bucket: 'finance_prod.silver_conformed_crm',
      description: 'ACID transactional data lake with schema evolution, time-travel, and fast upserts.',
    },
    {
      key: 'snowflake-dw',
      name: 'Snowflake Enterprise DW (Reverse-ETL)',
      type: 'Cloud Data Warehouse',
      iconColor: '#29b5e8',
      bucket: 'ANALYTICS.FINANCE.MRR_SUMMARY',
      description: 'High-performance cloud warehouse for executive dashboards and BI queries.',
    },
    {
      key: 'bigquery-marketing',
      name: 'Google Cloud BigQuery',
      type: 'Google Cloud Analytics',
      iconColor: '#4285f4',
      bucket: 'gcp-corp-data:marketing_lake',
      description: 'Central marketing repository for ad-tech attribution and campaign cohorts.',
    },
  ];

  // Form states
  const [selectedSourceKey, setSelectedSourceKey] = useState<string>('pg-prod');
  const [selectedDestKey, setSelectedDestKey] = useState<string>('iceberg-lake');
  const [connectionName, setConnectionName] = useState<string>('');
  const [frequency, setFrequency] = useState<string>('15 minutes');
  const [schemaDrift, setSchemaDrift] = useState<string>('propagate');
  const [enableQualityGate, setEnableQualityGate] = useState<boolean>(true);
  const [quarantineDLQ, setQuarantineDLQ] = useState<boolean>(true);
  const [selectedTags, setSelectedTags] = useState<string[]>(['prod', 'finance']);

  // Table stream configurations
  const [streamRows, setStreamRows] = useState([
    {
      key: '1',
      stream: 'orders',
      enabled: true,
      mode: 'Incremental | Deduped',
      cursor: 'updated_at',
      pk: 'order_id',
      estimatedRows: '48,520',
      columns: 14,
    },
    {
      key: '2',
      stream: 'customers',
      enabled: true,
      mode: 'Incremental | Deduped',
      cursor: 'updated_at',
      pk: 'customer_id',
      estimatedRows: '12,450',
      columns: 18,
    },
    {
      key: '3',
      stream: 'payments',
      enabled: true,
      mode: 'CDC | Append',
      cursor: 'wal_lsn',
      pk: 'payment_id',
      estimatedRows: '52,100',
      columns: 10,
    },
    {
      key: '4',
      stream: 'products',
      enabled: true,
      mode: 'Full Refresh | Overwrite',
      cursor: 'None',
      pk: 'product_id',
      estimatedRows: '840',
      columns: 8,
    },
  ]);

  const selectedSource = availableSources.find((s) => s.key === selectedSourceKey) || availableSources[0];
  const selectedDest = availableDestinations.find((d) => d.key === selectedDestKey) || availableDestinations[0];

  // Auto-generate connection name when source or dest changes
  const computedName = connectionName || `${selectedSource.name.split(' ')[0]} → ${selectedDest.name.split(' ')[0]}`;

  const handleNext = () => {
    if (currentStep < 3) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSubmit = () => {
    const newConn = {
      key: `conn-${Date.now()}`,
      id: `conn-${selectedSource.name.toLowerCase().slice(0, 3)}-${selectedDest.name.toLowerCase().slice(0, 3)}-${Math.floor(Math.random() * 900 + 100)}`,
      name: computedName,
      status: 'healthy',
      errorMessage: null,
      source: {
        name: selectedSource.name.split(' ')[0],
        type: selectedSource.type,
        iconColor: selectedSource.iconColor,
        streams: streamRows.filter((s) => s.enabled).length,
        host: selectedSource.host,
      },
      destination: {
        name: selectedDest.name.split(' ')[0],
        type: selectedDest.type,
        iconColor: selectedDest.iconColor,
        bucket: selectedDest.bucket,
      },
      frequency: frequency,
      tags: selectedTags,
      lastSync: 'Just configured',
      lastSyncDetail: `Ready to sync ${streamRows.filter((s) => s.enabled).length} streams on schedule`,
      qualityScore: enableQualityGate ? '100% Contract Validated' : 'Quality Checks Disabled',
      quarantinedCount: 0,
      enabled: true,
      syncHistory: [
        { date: 'Fri, Sep 4', status: 'success', count: 0 },
        { date: 'Sat, Sep 5', status: 'success', count: 0 },
        { date: 'Sun, Sep 6', status: 'success', count: 0 },
        { date: 'Mon, Sep 7', status: 'success', count: 0 },
        { date: 'Tue, Sep 8', status: 'success', count: 0 },
        { date: 'Wed, Sep 9', status: 'success', count: 0 },
        { date: 'Thu, Sep 10', status: 'success', count: 0 },
        { date: 'Fri, Sep 11', status: 'success', count: 1 },
      ],
    };

    onSave(newConn);
    message.success(`Connection "${newConn.name}" created successfully and scheduled!`);
    setCurrentStep(0);
    setConnectionName('');
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: '#00c2cb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            <SyncOutlined />
          </div>
          <div>
            <span style={{ fontSize: 16, fontWeight: 700 }}>New Data Connection</span>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>
              Connect any source to your Lakehouse or Reverse-ETL target with automated quality gates
            </div>
          </div>
        </div>
      }
      open={open}
      onCancel={onCancel}
      width={840}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          Cancel
        </Button>,
        currentStep > 0 && (
          <Button key="prev" onClick={handlePrev}>
            Previous
          </Button>
        ),
        currentStep < 3 ? (
          <Button key="next" type="primary" style={{ background: '#00c2cb', borderColor: '#00c2cb' }} onClick={handleNext}>
            Next Step
          </Button>
        ) : (
          <Button
            key="save"
            type="primary"
            icon={<CheckOutlined />}
            style={{ background: '#10b981', borderColor: '#10b981', fontWeight: 600 }}
            onClick={handleSubmit}
          >
            Save & Run Initial Sync
          </Button>
        ),
      ]}
    >
      <div style={{ padding: '10px 0 20px 0' }}>
        <Steps
          current={currentStep}
          size="small"
          items={[
            { title: 'Source', description: 'Origin DB or API' },
            { title: 'Destination', description: 'Lakehouse or DW' },
            { title: 'Streams', description: 'Tables & Sync Modes' },
            { title: 'Schedule & Rules', description: 'Cadence & Quality' },
          ]}
        />
      </div>

      <div style={{ minHeight: 380 }}>
        {/* STEP 0: SELECT SOURCE */}
        {currentStep === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Title level={5} style={{ margin: 0 }}>Select Data Source</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Choose from existing verified sources or configure a new source connector.
                </Text>
              </div>
              <Button size="small" icon={<PlusOutlined />} onClick={() => message.info('Opens connector marketplace with 50+ integrations')}>
                Add New Source
              </Button>
            </div>

            <Row gutter={[12, 12]}>
              {availableSources.map((src) => {
                const isSelected = selectedSourceKey === src.key;
                return (
                  <Col span={12} key={src.key}>
                    <Card
                      hoverable
                      size="small"
                      onClick={() => setSelectedSourceKey(src.key)}
                      style={{
                        borderRadius: 8,
                        borderColor: isSelected ? '#00c2cb' : '#e2e8f0',
                        borderWidth: isSelected ? 2 : 1,
                        background: isSelected ? '#f0fdfa' : '#ffffff',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <Space size={10} align="start">
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 6,
                              background: '#f1f5f9',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: src.iconColor,
                              fontSize: 16,
                            }}
                          >
                            <DatabaseOutlined />
                          </div>
                          <div>
                            <Text strong style={{ fontSize: 13, display: 'block' }}>
                              {src.name}
                            </Text>
                            <Tag color="blue" style={{ fontSize: 10, marginTop: 2 }}>
                              {src.type}
                            </Tag>
                          </div>
                        </Space>
                        {isSelected && <CheckCircleFilled style={{ color: '#00c2cb', fontSize: 18 }} />}
                      </div>

                      <div style={{ marginTop: 10, fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
                        {src.description}
                      </div>

                      <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Host: {src.host.split(':')[0]}</span>
                        <Tag color="cyan" style={{ fontSize: 10 }}>{src.streamsCount} streams</Tag>
                      </div>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          </div>
        )}

        {/* STEP 1: SELECT DESTINATION */}
        {currentStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Title level={5} style={{ margin: 0 }}>Select Data Destination</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Choose where data will land: Raw Bronze Object Storage, Silver Iceberg, or Snowflake Reverse-ETL.
                </Text>
              </div>
              <Button size="small" icon={<PlusOutlined />} onClick={() => message.info('Opens destination connector catalog')}>
                Add New Destination
              </Button>
            </div>

            <Row gutter={[12, 12]}>
              {availableDestinations.map((dest) => {
                const isSelected = selectedDestKey === dest.key;
                return (
                  <Col span={12} key={dest.key}>
                    <Card
                      hoverable
                      size="small"
                      onClick={() => setSelectedDestKey(dest.key)}
                      style={{
                        borderRadius: 8,
                        borderColor: isSelected ? '#00c2cb' : '#e2e8f0',
                        borderWidth: isSelected ? 2 : 1,
                        background: isSelected ? '#f0fdfa' : '#ffffff',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <Space size={10} align="start">
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 6,
                              background: '#f1f5f9',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: dest.iconColor,
                              fontSize: 16,
                            }}
                          >
                            <CloudUploadOutlined />
                          </div>
                          <div>
                            <Text strong style={{ fontSize: 13, display: 'block' }}>
                              {dest.name}
                            </Text>
                            <Tag color="purple" style={{ fontSize: 10, marginTop: 2 }}>
                              {dest.type}
                            </Tag>
                          </div>
                        </Space>
                        {isSelected && <CheckCircleFilled style={{ color: '#00c2cb', fontSize: 18 }} />}
                      </div>

                      <div style={{ marginTop: 10, fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
                        {dest.description}
                      </div>

                      <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
                        Target: <code>{dest.bucket}</code>
                      </div>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          </div>
        )}

        {/* STEP 2: STREAMS & TABLES CONFIGURATION */}
        {currentStep === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Title level={5} style={{ margin: 0 }}>Configure Replication Streams</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Source: <strong>{selectedSource.name}</strong> (4 tables introspected)
                </Text>
              </div>
              <Space>
                <Button
                  size="small"
                  onClick={() =>
                    setStreamRows((prev) => prev.map((s) => ({ ...s, enabled: true })))
                  }
                >
                  Select All
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    setStreamRows((prev) => prev.map((s) => ({ ...s, enabled: false })))
                  }
                >
                  Deselect All
                </Button>
              </Space>
            </div>

            <Table
              dataSource={streamRows}
              pagination={false}
              size="small"
              rowKey="key"
              columns={[
                {
                  title: 'Sync',
                  key: 'enabled',
                  width: 60,
                  render: (_: any, r: any) => (
                    <Checkbox
                      checked={r.enabled}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setStreamRows((prev) =>
                          prev.map((s) => (s.key === r.key ? { ...s, enabled: val } : s))
                        );
                      }}
                    />
                  ),
                },
                {
                  title: 'Table / Stream',
                  dataIndex: 'stream',
                  key: 'stream',
                  render: (t: string, r: any) => (
                    <Space size={6}>
                      <TableOutlined style={{ color: r.enabled ? '#3b82f6' : '#94a3b8' }} />
                      <Text strong={r.enabled} delete={!r.enabled}>
                        {t}
                      </Text>
                    </Space>
                  ),
                },
                {
                  title: 'Sync Mode',
                  key: 'mode',
                  width: 220,
                  render: (_: any, r: any) => (
                    <Select
                      size="small"
                      disabled={!r.enabled}
                      value={r.mode}
                      onChange={(v) =>
                        setStreamRows((prev) =>
                          prev.map((s) => (s.key === r.key ? { ...s, mode: v } : s))
                        )
                      }
                      style={{ width: '100%' }}
                      options={[
                        { label: 'Incremental | Append + Deduped', value: 'Incremental | Deduped' },
                        { label: 'Incremental | Append Only', value: 'Incremental | Append' },
                        { label: 'Full Refresh | Overwrite', value: 'Full Refresh | Overwrite' },
                        { label: 'CDC Log Replication', value: 'CDC | Append' },
                      ]}
                    />
                  ),
                },
                {
                  title: 'Cursor Field',
                  key: 'cursor',
                  width: 130,
                  render: (_: any, r: any) => (
                    <Select
                      size="small"
                      disabled={!r.enabled || r.mode.includes('Full Refresh')}
                      value={r.cursor}
                      onChange={(v) =>
                        setStreamRows((prev) =>
                          prev.map((s) => (s.key === r.key ? { ...s, cursor: v } : s))
                        )
                      }
                      style={{ width: '100%' }}
                      options={[
                        { label: 'updated_at', value: 'updated_at' },
                        { label: 'created_at', value: 'created_at' },
                        { label: 'wal_lsn', value: 'wal_lsn' },
                        { label: 'None', value: 'None' },
                      ]}
                    />
                  ),
                },
                {
                  title: 'Primary Key',
                  key: 'pk',
                  width: 120,
                  render: (_: any, r: any) => (
                    <Tag icon={<KeyOutlined />} color="gold" style={{ fontSize: 10 }}>
                      {r.pk}
                    </Tag>
                  ),
                },
                {
                  title: 'Columns',
                  key: 'cols',
                  width: 100,
                  render: (_: any, r: any) => (
                    <Button
                      size="small"
                      type="link"
                      disabled={!r.enabled}
                      style={{ padding: 0, fontSize: 11 }}
                      onClick={() => message.info(`Customizing ${r.columns} columns for table ${r.stream}`)}
                    >
                      {r.columns} cols
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        )}

        {/* STEP 3: SCHEDULE, SLA & DATA QUALITY */}
        {currentStep === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <Title level={5} style={{ margin: 0 }}>Connection Schedule & Quality Contracts</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Define how often data synchronizes, schema drift handling, and automated data quality assertions.
              </Text>
            </div>

            {/* Connection Name */}
            <div>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Connection Name
              </Text>
              <Input
                value={connectionName}
                placeholder={computedName}
                onChange={(e) => setConnectionName(e.target.value)}
                style={{ borderRadius: 6 }}
              />
            </div>

            {/* Frequency Selection */}
            <div>
              <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Sync Frequency (Replication Cadence)
              </Text>
              <Radio.Group
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                buttonStyle="solid"
                size="small"
              >
                <Radio.Button value="15 minutes">15 minutes (CDC)</Radio.Button>
                <Radio.Button value="1 hour">1 hour</Radio.Button>
                <Radio.Button value="6 hours">6 hours</Radio.Button>
                <Radio.Button value="24 hours">24 hours</Radio.Button>
                <Radio.Button value="Manual">Manual Trigger</Radio.Button>
              </Radio.Group>
            </div>

            <Row gutter={[16, 16]}>
              {/* Schema Drift Card */}
              <Col span={12}>
                <Card size="small" title="Schema Drift Policy" style={{ borderRadius: 8 }}>
                  <Radio.Group
                    value={schemaDrift}
                    onChange={(e) => setSchemaDrift(e.target.value)}
                    style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                  >
                    <Radio value="propagate">
                      <div>
                        <Text strong style={{ fontSize: 12 }}>Auto-Propagate (Recommended)</Text>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          Add new upstream columns dynamically to destination tables.
                        </div>
                      </div>
                    </Radio>
                    <Radio value="pause">
                      <div>
                        <Text strong style={{ fontSize: 12 }}>Detect & Pause (Safe Mode)</Text>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          Halt sync on column addition/removal and alert data engineer.
                        </div>
                      </div>
                    </Radio>
                  </Radio.Group>
                </Card>
              </Col>

              {/* Data Quality & Quarantine Card */}
              <Col span={12}>
                <Card
                  size="small"
                  title={
                    <Space>
                      <SafetyCertificateOutlined style={{ color: '#10b981' }} />
                      <span>Aicser Quality Gate</span>
                    </Space>
                  }
                  style={{ borderRadius: 8 }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Text strong style={{ fontSize: 12 }}>Contract Assertions</Text>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          Block null primary keys & check constraints.
                        </div>
                      </div>
                      <Switch
                        size="small"
                        checked={enableQualityGate}
                        onChange={(c) => setEnableQualityGate(c)}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Text strong style={{ fontSize: 12 }}>Dead-Letter Queue (DLQ)</Text>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          Quarantine failing rows with tombstones instead of crashing pipeline.
                        </div>
                      </div>
                      <Switch
                        size="small"
                        checked={quarantineDLQ}
                        onChange={(c) => setQuarantineDLQ(c)}
                      />
                    </div>
                  </div>
                </Card>
              </Col>
            </Row>

            {/* Summary Banner */}
            <Alert
              type="success"
              showIcon
              icon={<CheckCircleFilled />}
              message={
                <span>
                  Ready to deploy pipeline: <strong>{computedName}</strong> syncing{' '}
                  <strong>{streamRows.filter((s) => s.enabled).length} tables</strong> to{' '}
                  <strong>{selectedDest.name}</strong> every <strong>{frequency}</strong>.
                </span>
              }
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
