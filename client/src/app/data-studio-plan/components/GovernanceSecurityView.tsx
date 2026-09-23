'use client';

import React, { useState } from 'react';
import { Card, Table, Tag, Typography, Button, Space, Row, Col, Statistic, Badge, Switch, Modal, Select, Input, Alert } from 'antd';
import {
  SafetyCertificateOutlined,
  LockOutlined,
  EyeInvisibleOutlined,
  UsergroupAddOutlined,
  ScanOutlined,
  FileProtectOutlined,
  CheckCircleFilled,
} from '@ant-design/icons';

const { Title, Text } = Typography;

export function GovernanceSecurityView() {
  const [piiScanActive, setPiiScanActive] = useState(false);

  const piiColumns = [
    { key: '1', column: 'customer_email', table: 'silver_conformed_crm', piiType: 'Email Address', sensitivity: 'Confidential', masking: 'Partial (a***@acme.com)', active: true },
    { key: '2', column: 'phone_number', table: 'silver_conformed_crm', piiType: 'Phone Number', sensitivity: 'Confidential', masking: 'Redacted (***-***-8821)', active: true },
    { key: '3', column: 'stripe_charge_id', table: 'silver_conformed_crm', piiType: 'Financial Identifier', sensitivity: 'Restricted', masking: 'SHA-256 Hashed', active: true },
    { key: '4', column: 'customer_ip_address', table: 'bronze_raw_orders', piiType: 'IPv4 / Location', sensitivity: 'Internal', masking: 'Subnet Anonymized', active: true },
    { key: '5', column: 'internal_notes', table: 'source_postgres.orders', piiType: 'Free Text / Notes', sensitivity: 'Restricted', masking: 'Excluded from Silver/Gold', active: true },
  ];

  const rlsPolicies = [
    {
      key: '1',
      name: 'Tenant Data Isolation (Multi-Tenancy)',
      targetTable: 'All Silver & Gold Tables',
      predicate: "WHERE tenant_id = CURRENT_USER.tenant_id",
      appliesTo: 'All Standard Users & AI Agents',
      status: 'Enforced',
    },
    {
      key: '2',
      name: 'GDPR European Data Residency',
      targetTable: 'silver_conformed_crm',
      predicate: "WHERE billing_country IN ('DE', 'FR', 'UK', 'ES', 'IT')",
      appliesTo: 'Role: EU Data Analyst',
      status: 'Enforced',
    },
    {
      key: '3',
      name: 'Enterprise VIP Account Masking',
      targetTable: 'gold_financial_marts',
      predicate: "WHERE customer_tier != 'Enterprise' OR CURRENT_USER.role = 'Finance Executive'",
      appliesTo: 'Role: General BI Viewers',
      status: 'Enforced',
    },
  ];

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Overview KPI Row */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={6}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic title="PII Fields Scanned" value={5} prefix={<EyeInvisibleOutlined style={{ color: '#ef4444' }} />} />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic title="Active Masking Policies (CLS)" value={4} prefix={<LockOutlined style={{ color: '#8b5cf6' }} />} />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic title="Row-Level Policies (RLS)" value={3} prefix={<SafetyCertificateOutlined style={{ color: '#10b981' }} />} />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic title="Compliance Status" value="SOC2 / GDPR" valueStyle={{ color: '#00c2cb' }} />
          </Card>
        </Col>
      </Row>

      {/* Automated PII & Column-Level Security (CLS) */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space>
              <EyeInvisibleOutlined style={{ color: '#ef4444' }} />
              <span>Automated PII Discovery & Dynamic Column-Level Masking (CLS)</span>
            </Space>
            <Button
              size="small"
              icon={<ScanOutlined />}
              type="primary"
              style={{ background: '#00c2cb', borderColor: '#00c2cb' }}
            >
              Run Full PII Re-Scan
            </Button>
          </div>
        }
        style={{ borderRadius: 10 }}
      >
        <Alert
          type="info"
          showIcon
          message="Dynamic Data Masking Invariant"
          description="Privileged roles (Data Engineering, CFO) query plaintext data. Standard analysts, external syncs, and AI chat agents automatically receive masked / hashed representations."
          style={{ marginBottom: 14 }}
        />

        <Table
          dataSource={piiColumns}
          pagination={false}
          size="middle"
          columns={[
            {
              title: 'Column / Field',
              dataIndex: 'column',
              key: 'column',
              render: (t, r) => (
                <Space direction="vertical" size={1}>
                  <Text strong>{t}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{r.table}</Text>
                </Space>
              ),
            },
            {
              title: 'Detected PII Classification',
              dataIndex: 'piiType',
              key: 'piiType',
              render: (p) => <Tag color="red">{p}</Tag>,
            },
            {
              title: 'Sensitivity Tier',
              dataIndex: 'sensitivity',
              key: 'sensitivity',
              render: (s) => (
                <Tag color={s === 'Restricted' ? 'purple' : s === 'Confidential' ? 'orange' : 'blue'}>
                  {s}
                </Tag>
              ),
            },
            {
              title: 'Dynamic Masking Rule',
              dataIndex: 'masking',
              key: 'masking',
              render: (m) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{m}</span>,
            },
            {
              title: 'Enforced',
              dataIndex: 'active',
              key: 'active',
              render: (val) => <Switch defaultChecked={val} size="small" />,
            },
          ]}
        />
      </Card>

      {/* Row-Level Security (RLS) Policy Engine */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space>
              <SafetyCertificateOutlined style={{ color: '#10b981' }} />
              <span>Row-Level Security (RLS) Policy Management</span>
            </Space>
            <Button size="small">
              + New RLS Rule
            </Button>
          </div>
        }
        style={{ borderRadius: 10 }}
      >
        <Table
          dataSource={rlsPolicies}
          pagination={false}
          size="middle"
          columns={[
            {
              title: 'Policy Name',
              dataIndex: 'name',
              key: 'name',
              render: (t) => <Text strong>{t}</Text>,
            },
            {
              title: 'Target Layer / Table',
              dataIndex: 'targetTable',
              key: 'targetTable',
              render: (t) => <Tag color="blue">{t}</Tag>,
            },
            {
              title: 'SQL Predicate Filter',
              dataIndex: 'predicate',
              key: 'predicate',
              render: (p) => <Text code style={{ fontSize: 11 }}>{p}</Text>,
            },
            {
              title: 'Applies To Scope',
              dataIndex: 'appliesTo',
              key: 'appliesTo',
              render: (a) => <span style={{ fontSize: 12 }}>{a}</span>,
            },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (s) => <Badge status="success" text={<span style={{ fontWeight: 600 }}>{s}</span>} />,
            },
          ]}
        />
      </Card>
    </div>
  );
}
