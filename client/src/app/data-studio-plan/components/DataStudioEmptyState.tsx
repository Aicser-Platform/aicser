'use client';

import React from 'react';
import { Card, Button, Steps, Typography, Row, Col, Space, Tag } from 'antd';
import {
  DatabaseOutlined,
  SyncOutlined,
  CrownOutlined,
  ThunderboltOutlined,
  RocketOutlined,
  FileExcelOutlined,
  CloudServerOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

interface DataStudioEmptyStateProps {
  onLoadTemplate: (templateKey: string) => void;
  onExitEmptyState: () => void;
}

export function DataStudioEmptyState({ onLoadTemplate, onExitEmptyState }: DataStudioEmptyStateProps) {
  const stepsItems = [
    {
      title: 'Connect Source',
      description: 'Select RDBMS, Data Warehouse, or Upload File',
      icon: <DatabaseOutlined style={{ color: '#00c2cb' }} />,
    },
    {
      title: 'Configure Load Mode',
      description: 'Snapshot, Incremental Watermark, or CDC Stream',
      icon: <SyncOutlined style={{ color: '#0284c7' }} />,
    },
    {
      title: 'Medallion Target',
      description: 'Clean in Silver & Curate in Gold for GenBI',
      icon: <CrownOutlined style={{ color: '#eab308' }} />,
    },
  ];

  return (
    <div
      style={{
        padding: '36px 24px',
        maxWidth: 1080,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* Hero Badge */}
      <Tag
        color="cyan"
        style={{
          padding: '4px 12px',
          borderRadius: 16,
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 16,
        }}
      >
        <ThunderboltOutlined /> Aicser Universal Data Studio
      </Tag>

      <Title level={2} style={{ textAlign: 'center', marginBottom: 8 }}>
        Build Your First Universal Data Pipeline
      </Title>
      <Paragraph
        style={{
          textAlign: 'center',
          color: 'var(--ant-color-text-secondary, #64748b)',
          fontSize: 15,
          maxWidth: 640,
          marginBottom: 32,
        }}
      >
        Unify ingestion, Medallion Lakehouse transformations (Bronze → Silver → Gold),
        data quality gates, and reverse-ETL in one visual workspace without cognitive overload.
      </Paragraph>

      {/* 3-Step Guided Process */}
      <Card
        style={{
          width: '100%',
          marginBottom: 32,
          background: 'var(--ant-color-bg-container, #ffffff)',
          border: '1px solid var(--ant-color-border-secondary, #e2e8f0)',
          borderRadius: 12,
          boxShadow: '0 4px 12px -2px rgba(0,0,0,0.04)',
        }}
      >
        <Steps current={0} items={stepsItems} style={{ padding: '8px 16px' }} />
      </Card>

      {/* Quickstart 1-Click Templates */}
      <div style={{ width: '100%', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Title level={4} style={{ margin: 0, fontSize: 16 }}>
            Or Quickstart With Enterprise Templates (1-Click)
          </Title>
          <Button type="link" onClick={onExitEmptyState}>
            View Live Populated Pipeline →
          </Button>
        </div>

        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card
              hoverable
              onClick={() => onLoadTemplate('saas_mrr')}
              style={{
                borderRadius: 10,
                border: '1px solid var(--ant-color-border-secondary, #e2e8f0)',
                height: '100%',
              }}
            >
              <Space direction="vertical" size={8}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'rgba(0, 194, 203, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#00c2cb',
                    fontSize: 18,
                  }}
                >
                  <RocketOutlined />
                </div>
                <Text strong style={{ fontSize: 14 }}>SaaS Revenue & MRR Pipeline</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  PostgreSQL → Bronze Parquet → Silver Deduplication → Gold MRR Cube for GenBI.
                </Text>
                <div style={{ marginTop: 8 }}>
                  <Tag color="blue">PostgreSQL</Tag>
                  <Tag color="cyan">Iceberg</Tag>
                  <Tag color="gold">GenBI Ready</Tag>
                </div>
              </Space>
            </Card>
          </Col>

          <Col xs={24} md={8}>
            <Card
              hoverable
              onClick={() => onLoadTemplate('ecommerce_360')}
              style={{
                borderRadius: 10,
                border: '1px solid var(--ant-color-border-secondary, #e2e8f0)',
                height: '100%',
              }}
            >
              <Space direction="vertical" size={8}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'rgba(59, 130, 246, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#3b82f6',
                    fontSize: 18,
                  }}
                >
                  <CloudServerOutlined />
                </div>
                <Text strong style={{ fontSize: 14 }}>E-Commerce Customer 360</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Multi-source join: Orders (MySQL) + Web Events (ClickHouse) with PII scrubbing and automated quarantine.
                </Text>
                <div style={{ marginTop: 8 }}>
                  <Tag color="purple">Multi-Source</Tag>
                  <Tag color="green">Expectations</Tag>
                  <Tag color="cyan">Snowflake</Tag>
                </div>
              </Space>
            </Card>
          </Col>

          <Col xs={24} md={8}>
            <Card
              hoverable
              onClick={() => onLoadTemplate('excel_financials')}
              style={{
                borderRadius: 10,
                border: '1px solid var(--ant-color-border-secondary, #e2e8f0)',
                height: '100%',
              }}
            >
              <Space direction="vertical" size={8}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: 'rgba(16, 185, 129, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#10b981',
                    fontSize: 18,
                  }}
                >
                  <FileExcelOutlined />
                </div>
                <Text strong style={{ fontSize: 14 }}>Financial Excel Sheet Ingestion</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Multi-tab spreadsheet ingestion with currency extraction, null replacement, and PowerBI semantic sync.
                </Text>
                <div style={{ marginTop: 8 }}>
                  <Tag color="green">Spreadsheet</Tag>
                  <Tag color="orange">PowerBI</Tag>
                  <Tag color="cyan">Polaris</Tag>
                </div>
              </Space>
            </Card>
          </Col>
        </Row>
      </div>

      <Button
        type="primary"
        size="large"
        icon={<RocketOutlined />}
        onClick={onExitEmptyState}
        style={{
          background: '#00c2cb',
          borderColor: '#00c2cb',
          height: 44,
          padding: '0 28px',
          fontWeight: 600,
          borderRadius: 8,
        }}
      >
        Explore Populated Pipeline Workspace
      </Button>
    </div>
  );
}
