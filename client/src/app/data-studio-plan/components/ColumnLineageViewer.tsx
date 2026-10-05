'use client';

import React, { useState } from 'react';
import { Card, Table, Tag, Typography, Button, Space, Row, Col, Alert, Steps } from 'antd';
import {
  ApartmentOutlined,
  WarningOutlined,
  CheckCircleFilled,
  ArrowRightOutlined,
  SearchOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

export function ColumnLineageViewer() {
  const [selectedColumn, setSelectedColumn] = useState('total_amount');

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Overview Top Card */}
      <Alert
        type="info"
        showIcon
        icon={<ApartmentOutlined style={{ fontSize: 18 }} />}
        message="Enterprise End-to-End Column Lineage & Impact Analysis"
        description="Tracks every column from source tables through Bronze Parquet, Silver Iceberg, and Gold Marts down to GenBI AI prompts and BI dashboards. Enables automated schema break impact analysis."
      />

      {/* Interactive Lineage Chain Card */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space>
              <ApartmentOutlined style={{ color: '#00c2cb' }} />
              <span>Column Lineage Trace: <strong>total_amount → total_mrr</strong></span>
            </Space>
            <Tag color="cyan">Dialect Engine: SQLGlot AST</Tag>
          </div>
        }
        style={{ borderRadius: 10 }}
      >
        <div style={{ padding: '16px 8px', overflowX: 'auto' }}>
          <Row align="middle" justify="space-between" style={{ minWidth: 900 }}>
            {/* Step 1: Source */}
            <Col span={4}>
              <Card size="small" style={{ borderColor: '#3b82f6', borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 700, textTransform: 'uppercase' }}>
                  Source RDBMS
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>postgres.orders</div>
                <Tag color="blue" style={{ marginTop: 6 }}>total_amount [VARCHAR]</Tag>
              </Card>
            </Col>

            <Col span={1} style={{ textAlign: 'center', color: '#cbd5e1' }}>
              <ArrowRightOutlined />
            </Col>

            {/* Step 2: Bronze */}
            <Col span={4}>
              <Card size="small" style={{ borderColor: '#ea580c', borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: '#ea580c', fontWeight: 700, textTransform: 'uppercase' }}>
                  Bronze Raw Lake
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>bronze_raw_orders</div>
                <Tag color="orange" style={{ marginTop: 6 }}>total_amount [Parquet]</Tag>
              </Card>
            </Col>

            <Col span={1} style={{ textAlign: 'center', color: '#cbd5e1' }}>
              <ArrowRightOutlined />
            </Col>

            {/* Step 3: Silver */}
            <Col span={4}>
              <Card size="small" style={{ borderColor: '#0284c7', borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: '#0284c7', fontWeight: 700, textTransform: 'uppercase' }}>
                  Silver Conformed
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>silver_conformed_crm</div>
                <Tag color="cyan" style={{ marginTop: 6 }}>net_revenue_usd [DECIMAL]</Tag>
              </Card>
            </Col>

            <Col span={1} style={{ textAlign: 'center', color: '#cbd5e1' }}>
              <ArrowRightOutlined />
            </Col>

            {/* Step 4: Gold */}
            <Col span={4}>
              <Card size="small" style={{ borderColor: '#eab308', borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: '#eab308', fontWeight: 700, textTransform: 'uppercase' }}>
                  Gold Mart
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>gold_financial_marts</div>
                <Tag color="gold" style={{ marginTop: 6 }}>total_mrr [Metric]</Tag>
              </Card>
            </Col>

            <Col span={1} style={{ textAlign: 'center', color: '#cbd5e1' }}>
              <ArrowRightOutlined />
            </Col>

            {/* Step 5: Downstream Consumption */}
            <Col span={4}>
              <Card size="small" style={{ borderColor: '#8b5cf6', borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: '#8b5cf6', fontWeight: 700, textTransform: 'uppercase' }}>
                  Consumption Target
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>GenBI & Snowflake</div>
                <Tag color="purple" style={{ marginTop: 6 }}>AI Prompt Grounding</Tag>
              </Card>
            </Col>
          </Row>
        </div>
      </Card>

      {/* Impact Analysis Warning Card */}
      <Card
        title={
          <Space>
            <WarningOutlined style={{ color: '#f59e0b' }} />
            <span>Schema Mutation & Impact Analysis Simulator</span>
          </Space>
        }
        style={{ borderRadius: 10 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Text>
            <strong>Simulated Event:</strong> Upstream Postgres DBA renames <code>total_amount</code> to <code>gross_amount</code>.
          </Text>
          <Alert
            type="warning"
            showIcon
            message="Downstream Impact Detected (3 Assets Affected)"
            description={
              <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                <li><strong>silver_conformed_crm:</strong> Silver transform step 1 requires column mapping update.</li>
                <li><strong>gold_financial_marts:</strong> Metric formula <code>SUM(net_revenue_usd)</code> dependent on silver.</li>
                <li><strong>GenBI Semantic Model:</strong> Metric synonym lookup "MRR" requires re-verification.</li>
              </ul>
            }
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <Button size="small" type="primary" style={{ background: '#00c2cb', borderColor: '#00c2cb' }}>
              Auto-Remediate Column Alias in Silver
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
