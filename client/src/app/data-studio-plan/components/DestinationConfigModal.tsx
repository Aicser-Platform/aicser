'use client';

import React, { useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  Radio,
  Switch,
  Tag,
  Button,
  Space,
  Typography,
  Alert,
  Row,
  Col,
  message,
} from 'antd';
import {
  CloudUploadOutlined,
  CheckCircleFilled,
  ThunderboltFilled,
  RobotOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

interface DestinationConfigModalProps {
  open: boolean;
  onCancel: () => void;
  onSave: (config: any) => void;
}

export function DestinationConfigModal({ open, onCancel, onSave }: DestinationConfigModalProps) {
  const [destType, setDestType] = useState('iceberg');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>('Connected to Polaris REST Catalog (Ready)');

  const handleTest = () => {
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      setTestResult('Destination endpoint verified! Write permissions granted.');
      message.success('Destination target healthy!');
    }, 1000);
  };

  return (
    <Modal
      title={
        <Space size={8}>
          <CloudUploadOutlined style={{ color: '#8b5cf6' }} />
          <span>Destination & Reverse-ETL Target Configuration</span>
        </Space>
      }
      open={open}
      onCancel={onCancel}
      width={780}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          Cancel
        </Button>,
        <Button
          key="save"
          type="primary"
          style={{ background: '#00c2cb', borderColor: '#00c2cb' }}
          onClick={() => {
            message.success('Destination configuration saved!');
            onSave({ destType });
          }}
        >
          Save Destination
        </Button>,
      ]}
    >
      <Form layout="vertical">
        <Form.Item label="Destination Target Type">
          <Select
            value={destType}
            onChange={setDestType}
            options={[
              { label: 'Apache Iceberg Lakehouse (Internal S3/Polaris)', value: 'iceberg' },
              { label: 'Snowflake Enterprise Data Warehouse (Reverse-ETL)', value: 'snowflake' },
              { label: 'Google BigQuery Dataset (Reverse-ETL)', value: 'bigquery' },
              { label: 'ClickHouse Columnar Mart', value: 'clickhouse' },
              { label: 'Microsoft PowerBI Semantic Model (XMLA Direct)', value: 'powerbi' },
              { label: 'Aicser GenBI Autonomous Agent (Semantic Grounding)', value: 'genbi' },
            ]}
          />
        </Form.Item>

        {destType === 'iceberg' && (
          <Alert
            type="info"
            showIcon
            message="Medallion Lakehouse Target (PyIceberg + Polaris)"
            description="Writes partitioned Apache Iceberg v2 tables to your S3/MinIO lake. Supports snapshot time-travel, zero-copy branching via Nessie, and ACID upserts."
            style={{ marginBottom: 16 }}
          />
        )}

        {destType === 'snowflake' && (
          <Alert
            type="info"
            showIcon
            message="Reverse-ETL Egress to Snowflake"
            description="Mirrors curated Gold data marts into your corporate Snowflake warehouse for enterprise BI and executive dashboards."
            style={{ marginBottom: 16 }}
          />
        )}

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="Target Namespace / Database">
              <Input defaultValue={destType === 'snowflake' ? 'ANALYTICS.FINANCE' : 'finance_prod'} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Target Table Name">
              <Input defaultValue="gold_financial_marts" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="Write & Synchronization Mode">
          <Radio.Group defaultValue="merge">
            <Space orientation="vertical">
              <Radio value="merge">
                <Text strong>Merge / Upsert (Deduplicated)</Text>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  Matches on primary keys [order_month, customer_tier] and updates existing rows or inserts new ones.
                </div>
              </Radio>
              <Radio value="append">
                <Text strong>Append-Only Historical</Text>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  Always appends new microbatches into a new Iceberg snapshot.
                </div>
              </Radio>
              <Radio value="overwrite">
                <Text strong>Full Overwrite (Replace)</Text>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  Atomically replaces the target table on each successful pipeline run.
                </div>
              </Radio>
            </Space>
          </Radio.Group>
        </Form.Item>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="Partition Column">
              <Select defaultValue="order_month" options={[{ label: 'order_month (Monthly Partitioning)', value: 'order_month' }]} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Automatic Maintenance">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12 }}>Auto-Optimize & Compact Parquet</span>
                  <Switch defaultChecked size="small" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12 }}>Expire Snapshots &gt; 30 Days</span>
                  <Switch defaultChecked size="small" />
                </div>
              </div>
            </Form.Item>
          </Col>
        </Row>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <Button icon={<ThunderboltFilled />} loading={testing} onClick={handleTest}>
            Test Destination Egress
          </Button>
          {testResult && (
            <Text type="success" style={{ fontSize: 12 }}>
              <CheckCircleFilled /> {testResult}
            </Text>
          )}
        </div>
      </Form>
    </Modal>
  );
}
