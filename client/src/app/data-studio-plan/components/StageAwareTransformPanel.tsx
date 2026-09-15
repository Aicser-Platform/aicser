'use client';

import React, { useState } from 'react';
import { Card, Tabs, Tag, Typography, Row, Col, Space, Button, Table, Alert, Badge, Steps } from 'antd';
import {
  InboxOutlined,
  TableOutlined,
  CrownOutlined,
  CheckCircleOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  ArrowRightOutlined,
  FilterOutlined,
  MergeCellsOutlined,
  ClusterOutlined,
  KeyOutlined,
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

export function StageAwareTransformPanel() {
  const [activeStage, setActiveStage] = useState<'bronze' | 'silver' | 'gold'>('silver');

  const stageOverview = {
    bronze: {
      title: 'Bronze Layer: Raw Ingestion & Historical Audit Landing',
      subtitle: 'Source → Bronze',
      color: '#ea580c',
      badge: 'Raw Immutable Parquet',
      policy: 'Zero Business Logic. Retain raw source shape with appended technical lineage metadata.',
      icon: <InboxOutlined style={{ fontSize: 24, color: '#ea580c' }} />,
    },
    silver: {
      title: 'Silver Layer: Conformed, Cleansed & Deduplicated Core',
      subtitle: 'Bronze → Silver',
      color: '#0284c7',
      badge: 'Conformed Apache Iceberg',
      policy: 'Clean, type-cast, deduplicate, mask PII, and join related source tables into conformed entities.',
      icon: <TableOutlined style={{ fontSize: 24, color: '#0284c7' }} />,
    },
    gold: {
      title: 'Gold Layer: Curated Marts & GenBI Semantic Products',
      subtitle: 'Silver → Gold',
      color: '#eab308',
      badge: 'Certified Star Schema',
      policy: 'Rollup aggregations, star schema dimensional modeling, and certified metric definitions for GenBI AI agents.',
      icon: <CrownOutlined style={{ fontSize: 24, color: '#eab308' }} />,
    },
  };

  const bronzeRules = [
    { key: '1', step: 'Technical Ingest Metadata', desc: 'Appends _load_id (UUID), _ingest_time, _source_stream, and _source_ip for strict data lineage.', status: 'Active' },
    { key: '2', step: 'Zero Mutation Policy', desc: 'Raw values preserved as-is. Negative amounts, malformed strings, and corrupt rows are preserved in Bronze for audit.', status: 'Enforced' },
    { key: '3', step: 'Compression & Partitioning', desc: 'Stores as Snappy/ZSTD compressed Parquet in S3/MinIO partitioned by [_load_id].', status: 'Active' },
    { key: '4', step: 'Schema Enforcement Gate', desc: 'Validates source stream matches declared schema columns; flags unexpected structure changes.', status: 'Active' },
  ];

  const silverRules = [
    { key: '1', step: 'Data Cleansing & Normalization', desc: 'Strips currency symbols ($ , €), trims leading/trailing whitespace, and lowercases emails.', status: 'Active' },
    { key: '2', step: 'Strict Type Casting', desc: 'Casts strings to DECIMAL(12,2), TIMESTAMPTZ, and integer types with safe NULL fallback on failure.', status: 'Active' },
    { key: '3', step: 'Entity Deduplication (Upsert)', desc: 'Applies ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY updated_at DESC) to eliminate duplicates.', status: 'Active' },
    { key: '4', step: 'Multi-Source Conformed Join', desc: 'Joins Postgres Orders with Postgres Customers and Stripe API Billing into a unified record.', status: 'Active' },
    { key: '5', step: 'Dynamic PII Masking', desc: 'Masks phone numbers (***-***-1234) and hashes customer tax identifiers via SHA-256.', status: 'Enforced' },
    { key: '6', step: 'Quality Gate & Quarantine', desc: 'Rows violating business constraints (e.g. negative amount) route to Quarantine Storage with tombstones.', status: 'Active' },
  ];

  const goldRules = [
    { key: '1', step: 'Star Schema Dimensional Modeling', desc: 'Creates Fact and Dimension structures (e.g. DimCustomer, DimTime, FactRevenue).', status: 'Active' },
    { key: '2', step: 'Metric Rollup Aggregations', desc: 'Computes monthly aggregations: SUM(net_revenue_usd) AS total_mrr, COUNT(order_id) AS paid_orders.', status: 'Active' },
    { key: '3', step: 'Window & Growth Analytics', desc: 'Calculates MoM Growth Rate and rolling 30-day customer velocity indicators.', status: 'Active' },
    { key: '4', step: 'GenBI Semantic Contract', desc: 'Attaches certified semantic tags, metric definitions, and synonyms for AI natural language querying.', status: 'Certified' },
    { key: '5', step: 'Reverse-ETL Downstream Sync', desc: 'Mirrors Gold marts to Snowflake ANALYTICS warehouse and Microsoft PowerBI direct datasets.', status: 'Active' },
  ];

  const currentOverview = stageOverview[activeStage];

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Medallion Navigation Stepper */}
      <Card size="small" style={{ borderRadius: 10, background: 'var(--ant-color-bg-container, #ffffff)' }}>
        <Row align="middle" justify="space-between">
          <Col span={7}>
            <div
              onClick={() => setActiveStage('bronze')}
              style={{
                cursor: 'pointer',
                padding: '12px 16px',
                borderRadius: 8,
                border: activeStage === 'bronze' ? '2px solid #ea580c' : '1px solid #e2e8f0',
                background: activeStage === 'bronze' ? 'rgba(234, 88, 12, 0.05)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <InboxOutlined style={{ fontSize: 24, color: '#ea580c' }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#ea580c', textTransform: 'uppercase' }}>
                  Stage 1: Ingest
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Bronze (Raw Lake)</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Immutable Parquet + Audit Tags</div>
              </div>
            </div>
          </Col>

          <Col span={1} style={{ textAlign: 'center', color: '#cbd5e1', fontSize: 18 }}>
            <ArrowRightOutlined />
          </Col>

          <Col span={7}>
            <div
              onClick={() => setActiveStage('silver')}
              style={{
                cursor: 'pointer',
                padding: '12px 16px',
                borderRadius: 8,
                border: activeStage === 'silver' ? '2px solid #0284c7' : '1px solid #e2e8f0',
                background: activeStage === 'silver' ? 'rgba(2, 132, 199, 0.05)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <TableOutlined style={{ fontSize: 24, color: '#0284c7' }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0284c7', textTransform: 'uppercase' }}>
                  Stage 2: Clean & Conformed
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Silver (Cleansed Iceberg)</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Deduplication, PII & Joins</div>
              </div>
            </div>
          </Col>

          <Col span={1} style={{ textAlign: 'center', color: '#cbd5e1', fontSize: 18 }}>
            <ArrowRightOutlined />
          </Col>

          <Col span={7}>
            <div
              onClick={() => setActiveStage('gold')}
              style={{
                cursor: 'pointer',
                padding: '12px 16px',
                borderRadius: 8,
                border: activeStage === 'gold' ? '2px solid #eab308' : '1px solid #e2e8f0',
                background: activeStage === 'gold' ? 'rgba(234, 179, 8, 0.05)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <CrownOutlined style={{ fontSize: 24, color: '#eab308' }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#eab308', textTransform: 'uppercase' }}>
                  Stage 3: Business Marts
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Gold (GenBI Analytics)</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Star Schemas & Verified Metrics</div>
              </div>
            </div>
          </Col>
        </Row>
      </Card>

      {/* Stage Detail Header Card */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space size={10}>
              {currentOverview.icon}
              <div>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{currentOverview.title}</span>
                <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>({currentOverview.subtitle})</span>
              </div>
            </Space>
            <Tag color="cyan" style={{ fontSize: 12, padding: '2px 8px' }}>
              {currentOverview.badge}
            </Tag>
          </div>
        }
        style={{ borderRadius: 10 }}
      >
        <Alert
          type="info"
          showIcon
          message="Stage Transformation Policy & Architectural Invariant"
          description={currentOverview.policy}
          style={{ marginBottom: 16 }}
        />

        <Table
          dataSource={activeStage === 'bronze' ? bronzeRules : activeStage === 'silver' ? silverRules : goldRules}
          pagination={false}
          size="middle"
          columns={[
            {
              title: 'Stage Transformation / Action',
              dataIndex: 'step',
              key: 'step',
              render: (t) => <Text strong style={{ fontSize: 13 }}>{t}</Text>,
              width: 280,
            },
            {
              title: 'Architectural Implementation & Guardrail',
              dataIndex: 'desc',
              key: 'desc',
              render: (d) => <span style={{ fontSize: 12, color: '#475569' }}>{d}</span>,
            },
            {
              title: 'Enforcement Status',
              dataIndex: 'status',
              key: 'status',
              width: 140,
              render: (s) => <Badge status={s === 'Certified' ? 'processing' : 'success'} text={<span style={{ fontWeight: 600, fontSize: 12 }}>{s}</span>} />,
            },
          ]}
        />
      </Card>
    </div>
  );
}
