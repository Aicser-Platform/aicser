'use client';

import React, { useState } from 'react';
import { Card, Table, Tag, Typography, Button, Space, Row, Col, Statistic, Input, Badge, Alert, Modal, message } from 'antd';
import {
  RobotOutlined,
  CheckCircleFilled,
  ThunderboltFilled,
  CalculatorOutlined,
  BlockOutlined,
  SendOutlined,
  StarFilled,
  CodeOutlined,
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

export function SemanticLayerStudio() {
  const [nlQuery, setNlQuery] = useState('What was our Enterprise MRR in September 2026?');
  const [nlResult, setNlResult] = useState<any>(null);
  const [nlLoading, setNlLoading] = useState(false);

  const metricsData = [
    {
      key: '1',
      name: 'Total MRR',
      formula: 'SUM(net_revenue_usd)',
      type: 'Currency (USD)',
      synonyms: ['MRR', 'Monthly Recurring Revenue', 'Turnover', 'Sales'],
      certified: true,
      certifiedBy: 'Head of Finance (SOC2)',
    },
    {
      key: '2',
      name: 'Paid Orders Count',
      formula: 'COUNT(DISTINCT order_id)',
      type: 'Count (Integer)',
      synonyms: ['Order Volume', 'Completed Transactions', 'Checkout Count'],
      certified: true,
      certifiedBy: 'RevOps Lead',
    },
    {
      key: '3',
      name: 'Avg Order Value (AOV)',
      formula: 'SUM(net_revenue_usd) / COUNT(order_id)',
      type: 'Currency (USD)',
      synonyms: ['AOV', 'Average Basket Size', 'Ticket Size'],
      certified: true,
      certifiedBy: 'Product Analytics',
    },
    {
      key: '4',
      name: 'Net Revenue Retention (NRR)',
      formula: '(starting_mrr + expansion_mrr - churn_mrr) / starting_mrr',
      type: 'Percentage (%)',
      synonyms: ['NRR', 'Retention Rate', 'Cohort Expansion'],
      certified: true,
      certifiedBy: 'CFO Office',
    },
  ];

  const dimensionsData = [
    { key: '1', name: 'order_month', type: 'Time Dimension (Grain: Month)', primary: true, description: 'Calendar month derived via strftime(created_at, %Y-%m)' },
    { key: '2', name: 'customer_tier', type: 'Categorical Tier', primary: false, description: 'Enterprise ($1000+), Growth ($300+), Starter' },
    { key: '3', name: 'billing_country', type: 'Geographic Dimension', primary: false, description: 'ISO 2-letter country code (US, DE, FR, UK)' },
  ];

  const handleRunNlQuery = () => {
    setNlLoading(true);
    setTimeout(() => {
      setNlLoading(false);
      setNlResult({
        sql: `SELECT order_month, customer_tier, SUM(total_mrr) AS total_mrr\nFROM gold_financial_marts\nWHERE customer_tier = 'Enterprise' AND order_month = '2026-09'\nGROUP BY 1, 2;`,
        explanation: `Mapped user prompt "Enterprise MRR" to verified metric "Total MRR" and filtered on customer_tier = 'Enterprise' for order_month = '2026-09'.`,
        value: '$4,240.00',
      });
      message.success('GenBI semantic query grounded successfully!');
    }, 900);
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Overview Top Card */}
      <Alert
        type="success"
        showIcon
        icon={<RobotOutlined style={{ fontSize: 18 }} />}
        message="GenBI Semantic Layer & Prompt Grounding Hub"
        description="The semantic layer bridges the gap between curated Gold Iceberg marts and GenBI AI agents. Defining verified metrics and business synonyms guarantees the AI generates 100% accurate, non-hallucinated SQL."
      />

      {/* Metrics & Measures Definition Table */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space>
              <CalculatorOutlined style={{ color: '#00c2cb' }} />
              <span>Certified Business Metrics (Measures)</span>
            </Space>
            <Button size="small" type="primary" style={{ background: '#00c2cb', borderColor: '#00c2cb' }}>
              + Define Metric
            </Button>
          </div>
        }
        style={{ borderRadius: 10 }}
      >
        <Table
          dataSource={metricsData}
          pagination={false}
          size="middle"
          columns={[
            {
              title: 'Metric Name',
              dataIndex: 'name',
              key: 'name',
              render: (t, r) => (
                <Space>
                  <Text strong>{t}</Text>
                  {r.certified && <Tag color="gold" icon={<StarFilled />}>Certified</Tag>}
                </Space>
              ),
            },
            {
              title: 'Mathematical Formula',
              dataIndex: 'formula',
              key: 'formula',
              render: (f) => <Text code style={{ fontSize: 12 }}>{f}</Text>,
            },
            {
              title: 'Data Type',
              dataIndex: 'type',
              key: 'type',
              render: (t) => <Tag color="blue">{t}</Tag>,
            },
            {
              title: 'AI Prompt Synonyms',
              dataIndex: 'synonyms',
              key: 'synonyms',
              render: (syns: string[]) => (
                <Space size={[4, 4]} wrap>
                  {syns.map((s) => (
                    <Tag key={s} bordered={false} style={{ fontSize: 10 }}>{s}</Tag>
                  ))}
                </Space>
              ),
            },
            {
              title: 'Governance Auditor',
              dataIndex: 'certifiedBy',
              key: 'certifiedBy',
              render: (c) => <span style={{ fontSize: 11, color: '#64748b' }}>{c}</span>,
            },
          ]}
        />
      </Card>

      {/* Dimensions Table */}
      <Card
        title={
          <Space>
            <BlockOutlined style={{ color: '#3b82f6' }} />
            <span>Semantic Dimensions & Grains</span>
          </Space>
        }
        style={{ borderRadius: 10 }}
      >
        <Table
          dataSource={dimensionsData}
          pagination={false}
          size="middle"
          columns={[
            {
              title: 'Dimension Name',
              dataIndex: 'name',
              key: 'name',
              render: (t, r) => (
                <Space>
                  <Text strong>{t}</Text>
                  {r.primary && <Tag color="cyan">Primary Time</Tag>}
                </Space>
              ),
            },
            { title: 'Dimension Type', dataIndex: 'type', key: 'type', render: (t) => <Tag>{t}</Tag> },
            { title: 'Business Definition & Grain', dataIndex: 'description', key: 'description' },
          ]}
        />
      </Card>

      {/* GenBI Prompt Grounding Simulator */}
      <Card
        title={
          <Space>
            <RobotOutlined style={{ color: '#8b5cf6' }} />
            <span>GenBI AI Prompt Grounding Simulator (Test Semantic Contract)</span>
          </Space>
        }
        style={{ borderRadius: 10, background: 'var(--ant-color-bg-container, #ffffff)' }}
      >
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <Input
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            placeholder="Ask questions like: What was our Enterprise MRR in September 2026?"
            style={{ borderRadius: 6 }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={nlLoading}
            onClick={handleRunNlQuery}
            style={{ background: '#8b5cf6', borderColor: '#8b5cf6', borderRadius: 6 }}
          >
            Ground Query
          </Button>
        </div>

        {nlResult && (
          <div
            style={{
              padding: 16,
              borderRadius: 8,
              background: '#0f172a',
              color: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Space>
                <CheckCircleFilled style={{ color: '#10b981' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Deterministic Grounded SQL:</span>
              </Space>
              <Tag color="purple">Result: {nlResult.value}</Tag>
            </div>
            <pre style={{ margin: 0, fontSize: 12, color: '#38bdf8', fontFamily: 'monospace' }}>
              {nlResult.sql}
            </pre>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              ℹ️ {nlResult.explanation}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
