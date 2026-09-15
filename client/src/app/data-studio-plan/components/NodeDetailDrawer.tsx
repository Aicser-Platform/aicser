'use client';

import React from 'react';
import { Card, Tag, Typography, Descriptions, Table, Space, Button, Alert, Divider } from 'antd';
import {
  SafetyCertificateOutlined,
  PlayCircleOutlined,
  WarningOutlined,
  KeyOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  CodeOutlined,
  SettingOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons';
import { MOCK_PIPELINE_NODES, type PipelineNodeData } from '../data/mockPipelineData';

const { Title, Text } = Typography;

interface NodeDetailDrawerProps {
  nodeId: string;
  onOpenYaml: () => void;
  onSelectTab: (tabKey: string) => void;
  onOpenSourceConfig?: () => void;
  onOpenDestConfig?: () => void;
}

export function NodeDetailDrawer({
  nodeId,
  onOpenYaml,
  onSelectTab,
  onOpenSourceConfig,
  onOpenDestConfig,
}: NodeDetailDrawerProps) {
  const node: PipelineNodeData = MOCK_PIPELINE_NODES[nodeId] || MOCK_PIPELINE_NODES['silver-cleaned'];

  const schemaColumns = [
    {
      title: 'Column',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, row: any) => (
        <Space size={6}>
          <Text strong style={{ fontSize: 12 }}>{text}</Text>
          {row.isPk && <Tag color="gold" icon={<KeyOutlined />}>PK</Tag>}
          {row.isMetric && <Tag color="purple">Metric</Tag>}
        </Space>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (text: string) => <Tag bordered={false} style={{ fontSize: 11, fontFamily: 'monospace' }}>{text}</Tag>,
    },
    {
      title: 'Nullable',
      dataIndex: 'nullable',
      key: 'nullable',
      width: 80,
      render: (val: boolean) => (
        <span style={{ fontSize: 11, color: val ? '#94a3b8' : '#ef4444', fontWeight: val ? 400 : 600 }}>
          {val ? 'YES' : 'NO'}
        </span>
      ),
    },
  ];

  const isSource = node.type === 'source' || node.type === 'source_group';
  const isDest = node.type === 'destination';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--ant-color-bg-container, #ffffff)' }}>
      {/* Header */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--ant-color-border-secondary, #f1f5f9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Space size={8}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: node.accentColor,
            }}
          />
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: node.accentColor, textTransform: 'uppercase' }}>
              {node.layerLabel}
            </div>
            <Title level={5} style={{ margin: 0, fontSize: 15 }}>
              {node.name}
            </Title>
          </div>
        </Space>

        <Space size={6}>
          {isSource && onOpenSourceConfig && (
            <Button size="small" icon={<SettingOutlined />} onClick={onOpenSourceConfig}>
              Config Streams
            </Button>
          )}
          {isDest && onOpenDestConfig && (
            <Button size="small" icon={<CloudUploadOutlined />} onClick={onOpenDestConfig}>
              Config Egress
            </Button>
          )}
          <Button size="small" icon={<CodeOutlined />} onClick={onOpenYaml}>
            YAML
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={() => onSelectTab('preview')}
            style={{ background: '#00c2cb', borderColor: '#00c2cb' }}
          >
            Data Prep
          </Button>
        </Space>
      </div>

      {/* Body Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }} className="aiser-themed-scrollbar">
        {/* Description Alert */}
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 6,
            background: 'var(--ant-color-fill-secondary, #f8fafc)',
            border: '1px solid var(--ant-color-border-secondary, #e2e8f0)',
            fontSize: 12,
            color: 'var(--ant-color-text-secondary, #475569)',
            marginBottom: 16,
          }}
        >
          {node.details.description}
        </div>

        {/* Node Specs */}
        <Title level={5} style={{ fontSize: 13, marginBottom: 8 }}>
          Configuration & Multi-Stream Parameters
        </Title>
        <Descriptions
          size="small"
          column={1}
          bordered
          style={{ marginBottom: 16 }}
          labelStyle={{ width: 130, fontSize: 12, color: 'var(--ant-color-text-secondary, #64748b)' }}
          contentStyle={{ fontSize: 12, fontWeight: 500 }}
        >
          {node.tablesCount && (
            <Descriptions.Item label="Introspected Tables">
              <Tag color="blue">{node.tablesCount} Tables Active</Tag>
            </Descriptions.Item>
          )}
          {node.details.mode && <Descriptions.Item label="Load Mode">{node.details.mode}</Descriptions.Item>}
          {node.details.engine && <Descriptions.Item label="Engine">{node.details.engine}</Descriptions.Item>}
          {node.details.format && <Descriptions.Item label="Storage Format">{node.details.format}</Descriptions.Item>}
          {node.details.schedule && (
            <Descriptions.Item label="Sync Cadence">
              <Tag icon={<ClockCircleOutlined />} color="cyan">{node.details.schedule}</Tag>
            </Descriptions.Item>
          )}
          {node.details.watermark && (
            <Descriptions.Item label="Watermark Cursor">
              <Tag color="cyan">{node.details.watermark}</Tag>
            </Descriptions.Item>
          )}
          {node.details.schemaEvolution && (
            <Descriptions.Item label="Schema Drift Policy">
              <Tag color="green">{node.details.schemaEvolution}</Tag>
            </Descriptions.Item>
          )}
          {node.details.primaryKey && (
            <Descriptions.Item label="Primary Key">
              {node.details.primaryKey.map((k) => (
                <Tag key={k} color="gold">{k}</Tag>
              ))}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Current Rows">
            <Text strong>{node.rowCount.toLocaleString()} rows</Text>
          </Descriptions.Item>
        </Descriptions>

        {/* Quality Alerts if applicable */}
        {node.details.quarantineCount && node.details.quarantineCount > 0 && (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message={`${node.details.quarantineCount} Rows Quarantined`}
            description="Failed 'positive_order_amount' expectation. These rows were isolated without aborting the pipeline run."
            action={
              <Button size="small" danger onClick={() => onSelectTab('quarantine')}>
                Inspect Quarantine
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        )}

        {/* Schema Table */}
        {node.schema && node.schema.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Title level={5} style={{ fontSize: 13, margin: 0 }}>
                Schema & Field Profiling ({node.schema.length} fields)
              </Title>
              <Tag color="green" icon={<CheckCircleOutlined />}>Verified Contract</Tag>
            </div>
            <Table
              dataSource={node.schema}
              columns={schemaColumns}
              pagination={false}
              size="small"
              rowKey="name"
              style={{ border: '1px solid var(--ant-color-border-secondary, #f1f5f9)', borderRadius: 6 }}
            />
          </>
        )}
      </div>
    </div>
  );
}
