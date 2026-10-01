'use client';

import React, { useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  Radio,
  Switch,
  Table,
  Tag,
  Button,
  Tabs,
  Space,
  Typography,
  Alert,
  Divider,
  Row,
  Col,
  message,
} from 'antd';
import {
  DatabaseOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  SettingOutlined,
  ThunderboltFilled,
  ApartmentOutlined,
} from '@ant-design/icons';
import { MOCK_MULTI_TABLE_STREAMS } from '../data/mockPipelineData';

const { Title, Text, Paragraph } = Typography;

interface SourceConfigModalProps {
  open: boolean;
  onCancel: () => void;
  onSave: (config: any) => void;
}

export function SourceConfigModal({ open, onCancel, onSave }: SourceConfigModalProps) {
  const [activeTab, setActiveTab] = useState('streams');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>('Connected successfully (latency: 14ms)');
  const [streams, setStreams] = useState(MOCK_MULTI_TABLE_STREAMS);

  const handleTestConnection = () => {
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      setTestResult('Connected successfully! Introspected 4 schemas, 18 tables.');
      message.success('Source connection healthy!');
    }, 1200);
  };

  const streamColumns = [
    {
      title: 'Table Name',
      dataIndex: 'table',
      key: 'table',
      render: (t: string, r: any) => (
        <Space>
          <Text strong style={{ fontSize: 12 }}>{t}</Text>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>({r.schema})</span>
        </Space>
      ),
    },
    {
      title: 'Sync Mode',
      dataIndex: 'mode',
      key: 'mode',
      render: (mode: string, r: any, idx: number) => (
        <Select
          size="small"
          value={mode}
          style={{ width: 170 }}
          onChange={(newMode) => {
            const updated = [...streams];
            updated[idx].mode = newMode;
            setStreams(updated);
          }}
          options={[
            { label: 'Incremental Watermark', value: 'Incremental Watermark' },
            { label: 'Append Log (CDC)', value: 'Append Log (CDC)' },
            { label: 'Full Refresh Snapshot', value: 'Full Refresh Snapshot' },
            { label: 'Excluded / Skip', value: 'Excluded' },
          ]}
        />
      ),
    },
    {
      title: 'Cursor Column',
      dataIndex: 'cursor',
      key: 'cursor',
      render: (c: string) => <Tag color="cyan">{c}</Tag>,
    },
    {
      title: 'Primary Key',
      dataIndex: 'primaryKey',
      key: 'primaryKey',
      render: (pk: string) => <Tag color="gold">{pk}</Tag>,
    },
    {
      title: 'Estimated Rows',
      dataIndex: 'records',
      key: 'records',
      render: (rec: number) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{rec.toLocaleString()}</span>,
    },
  ];

  return (
    <Modal
      title={
        <Space size={8}>
          <DatabaseOutlined style={{ color: '#00c2cb' }} />
          <span>Source Connection & Multi-Table Ingestion Strategy</span>
        </Space>
      }
      open={open}
      onCancel={onCancel}
      width={860}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          Cancel
        </Button>,
        <Button
          key="save"
          type="primary"
          style={{ background: '#00c2cb', borderColor: '#00c2cb' }}
          onClick={() => {
            message.success('Source & Multi-Table stream configurations updated!');
            onSave(streams);
          }}
        >
          Save & Apply Strategy
        </Button>,
      ]}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'streams',
            label: `Multi-Table Streams (${streams.filter((s) => s.mode !== 'Excluded').length} Active)`,
            children: (
              <div>
                <Alert
                  type="info"
                  showIcon
                  message="Single Connection, Multi-Stream Execution"
                  description="Aicser extracts tables concurrently using isolated worker microbatches. Failure in one table (e.g. timeout) does not block or fail other tables."
                  style={{ marginBottom: 14 }}
                />

                <Table
                  dataSource={streams}
                  columns={streamColumns}
                  pagination={false}
                  size="small"
                  rowKey="table"
                />
              </div>
            ),
          },
          {
            key: 'schedule',
            label: 'Scheduling & Sync Cadence',
            children: (
              <div style={{ padding: '8px 0' }}>
                <Form layout="vertical">
                  <Form.Item label="Execution Cadence">
                    <Radio.Group defaultValue="interval">
                      <Radio.Button value="interval">Fixed Interval</Radio.Button>
                      <Radio.Button value="cron">Custom Cron</Radio.Button>
                      <Radio.Button value="target_lag">Target Freshness Lag (SLA)</Radio.Button>
                    </Radio.Group>
                  </Form.Item>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label="Frequency">
                        <Select
                          defaultValue="15m"
                          options={[
                            { label: 'Every 5 Minutes (Near Real-time)', value: '5m' },
                            { label: 'Every 15 Minutes (Recommended)', value: '15m' },
                            { label: 'Hourly (0 * * * *)', value: '1h' },
                            { label: 'Daily (Midnight UTC)', value: '24h' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="Parallel Extract Workers">
                        <Select
                          defaultValue="4"
                          options={[
                            { label: '2 Parallel Threads', value: '2' },
                            { label: '4 Parallel Threads (Default)', value: '4' },
                            { label: '8 High-Throughput Threads', value: '8' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.Item label="Schema Evolution Policy (Industry Airbyte/Fivetran Standard)">
                    <Radio.Group defaultValue="auto">
                      <Space orientation="vertical">
                        <Radio value="auto">
                          <Text strong>Auto-Propagate (Non-breaking)</Text>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            New source columns automatically append as NULLABLE in Bronze & Silver without interrupting syncs.
                          </div>
                        </Radio>
                        <Radio value="pause">
                          <Text strong>Pause & Alert on Drift</Text>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            Pipeline pauses and triggers Slack/Email alert whenever source schema changes.
                          </div>
                        </Radio>
                        <Radio value="ignore">
                          <Text strong>Ignore New Columns</Text>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            Only ingest existing known schema fields; discard unmapped source columns.
                          </div>
                        </Radio>
                      </Space>
                    </Radio.Group>
                  </Form.Item>
                </Form>
              </div>
            ),
          },
          {
            key: 'credentials',
            label: 'Connection Credentials & SSL',
            children: (
              <Form layout="vertical">
                <Row gutter={12}>
                  <Col span={16}>
                    <Form.Item label="Host Endpoint">
                      <Input defaultValue="prod-db-cluster.rds.amazonaws.com" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="Port">
                      <Input defaultValue="5432" />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item label="Database Name">
                      <Input defaultValue="crm_production" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="Username">
                      <Input defaultValue="aicser_ro_replicator" />
                    </Form.Item>
                  </Col>
                </Row>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                  <Button icon={<ThunderboltFilled />} loading={testing} onClick={handleTestConnection}>
                    Test Connection & Ping
                  </Button>
                  {testResult && (
                    <Text type="success" style={{ fontSize: 12 }}>
                      <CheckCircleFilled /> {testResult}
                    </Text>
                  )}
                </div>
              </Form>
            ),
          },
        ]}
      />
    </Modal>
  );
}
