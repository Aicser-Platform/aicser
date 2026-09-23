'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Layout,
  Button,
  Segmented,
  Tag,
  Space,
  Tabs,
  Typography,
  Table,
  Badge,
  Modal,
  Card,
  Row,
  Col,
  Statistic,
  Progress,
  message,
  Tooltip,
} from 'antd';
import {
  ThunderboltFilled,
  PlayCircleOutlined,
  CodeOutlined,
  ApartmentOutlined,
  DatabaseOutlined,
  SafetyCertificateOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  AppstoreOutlined,
  ExportOutlined,
  CheckCircleFilled,
  WarningFilled,
  ClockCircleOutlined,
  EyeOutlined,
  SwapOutlined,
  SettingOutlined,
  CloudUploadOutlined,
  TableOutlined,
  ClusterOutlined,
  RobotOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';

import { MOCK_PIPELINE_NODES, MOCK_YAML_DEFINITION, type PipelineNodeData } from './data/mockPipelineData';
import { PipelineFlowCanvas } from './components/PipelineFlowCanvas';
import { NodeDetailDrawer } from './components/NodeDetailDrawer';
import { DataStudioEmptyState } from './components/DataStudioEmptyState';
import { ConnectorHubView } from './components/ConnectorHubView';
import { VisualDataPrepGrid } from './components/VisualDataPrepGrid';
import { SourceConfigModal } from './components/SourceConfigModal';
import { DestinationConfigModal } from './components/DestinationConfigModal';
import { StageAwareTransformPanel } from './components/StageAwareTransformPanel';
import { GovernanceSecurityView } from './components/GovernanceSecurityView';
import { SemanticLayerStudio } from './components/SemanticLayerStudio';
import { ColumnLineageViewer } from './components/ColumnLineageViewer';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const { Header, Content, Sider } = Layout;
const { Title, Text, Paragraph } = Typography;

export default function DataStudioPlanPage() {
  const [activeTab, setActiveTab] = useState<
    'flow' | 'connectors' | 'stages' | 'governance' | 'semantic' | 'lineage' | 'catalog' | 'observability'
  >('flow');
  const [viewMode, setViewMode] = useState<'visual' | 'code' | 'split'>('visual');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('silver-cleaned');
  const [bottomTab, setBottomTab] = useState<'prep' | 'quarantine' | 'logs'>('prep');
  const [isEmptyState, setIsEmptyState] = useState<boolean>(false);
  const [critiqueModalOpen, setCritiqueModalOpen] = useState<boolean>(false);
  const [sourceModalOpen, setSourceModalOpen] = useState<boolean>(false);
  const [destModalOpen, setDestModalOpen] = useState<boolean>(false);
  const [isRunningSimulation, setIsRunningSimulation] = useState<boolean>(false);
  const [yamlContent, setYamlContent] = useState<string>(MOCK_YAML_DEFINITION);

  const selectedNode = MOCK_PIPELINE_NODES[selectedNodeId] || MOCK_PIPELINE_NODES['silver-cleaned'];

  const handleRunSimulation = () => {
    setIsRunningSimulation(true);
    message.loading({ content: 'Orchestrating multi-table pipeline: 4 parallel streams extracting -> Writing Bronze -> Quality Gate -> Silver Conformed...', key: 'sim' });
    setTimeout(() => {
      setIsRunningSimulation(false);
      message.success({ content: 'Multi-table pipeline completed in 1.84s! 48,498 conformed rows committed to Gold & mirrored to Snowflake.', key: 'sim' });
    }, 2000);
  };

  // Quarantine Table Columns
  const quarantineColumns = [
    { title: 'Order ID', dataIndex: 'order_id', key: 'order_id' },
    { title: 'Customer ID', dataIndex: 'customer_id', key: 'customer_id' },
    { title: 'Value', dataIndex: 'total_amount', key: 'total_amount' },
    {
      title: 'Quarantine Reason',
      dataIndex: '_quarantine_reason',
      key: '_quarantine_reason',
      render: (t: string) => <Tag color="error">{t}</Tag>,
    },
    { title: 'Captured At', dataIndex: 'captured_at', key: 'captured_at' },
    {
      title: 'Remediation Action',
      key: 'remediate',
      render: () => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => message.success('Applied remediation rule: Coalesce to 0.00')}>
            Fix & Reprocess
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Layout style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top Application Header */}
      <Header
        style={{
          height: 52,
          padding: '0 20px',
          background: 'var(--ant-color-bg-container, #ffffff)',
          borderBottom: '1px solid var(--ant-color-border-secondary, #e2e8f0)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 10,
        }}
      >
        {/* Brand & Workspace Context */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              A
            </div>
            <Title level={5} style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              Aicser Data Studio
            </Title>
          </div>

          <Tag color="cyan" style={{ borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
            Universal Multi-Source ELT / ETL
          </Tag>

          <span style={{ color: '#cbd5e1' }}>|</span>

          {/* Top Level Section Tabs */}
          <Segmented
            value={activeTab}
            onChange={(val) => setActiveTab(val as any)}
            options={[
              { label: 'Pipeline DAG', value: 'flow', icon: <ApartmentOutlined /> },
              { label: 'Connectors & Egress', value: 'connectors', icon: <DatabaseOutlined /> },
              { label: 'Stage Rules', value: 'stages', icon: <ClusterOutlined /> },
              { label: 'Governance & PII', value: 'governance', icon: <SafetyCertificateOutlined /> },
              { label: 'Semantic Studio', value: 'semantic', icon: <RobotOutlined /> },
              { label: 'Lineage', value: 'lineage', icon: <NodeIndexOutlined /> },
              { label: 'Catalog', value: 'catalog', icon: <AppstoreOutlined /> },
              { label: 'Observability', value: 'observability', icon: <ClockCircleOutlined /> },
            ]}
          />
        </div>

        {/* Persona Switcher & Primary Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {activeTab === 'flow' && (
            <Segmented
              value={viewMode}
              onChange={(val) => setViewMode(val as any)}
              options={[
                { label: 'Visual Flow', value: 'visual', icon: <ApartmentOutlined /> },
                { label: 'Split View', value: 'split', icon: <SwapOutlined /> },
                { label: 'Code / YAML', value: 'code', icon: <CodeOutlined /> },
              ]}
            />
          )}

          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => setSourceModalOpen(true)}
            style={{ borderRadius: 6 }}
          >
            Config Sources (4)
          </Button>

          <Button
            size="small"
            icon={<CloudUploadOutlined />}
            onClick={() => setDestModalOpen(true)}
            style={{ borderRadius: 6 }}
          >
            Config Egress
          </Button>

          <Button
            size="small"
            type={isEmptyState ? 'primary' : 'default'}
            onClick={() => setIsEmptyState((prev) => !prev)}
            style={{ borderRadius: 6 }}
          >
            {isEmptyState ? 'Show Populated Demo' : 'Empty State'}
          </Button>

          <Button
            size="small"
            icon={<InfoCircleOutlined />}
            onClick={() => setCritiqueModalOpen(true)}
            style={{ borderRadius: 6 }}
          >
            Audit & Critique
          </Button>

          <Button
            type="primary"
            size="small"
            icon={<PlayCircleOutlined />}
            loading={isRunningSimulation}
            onClick={handleRunSimulation}
            style={{
              background: '#00c2cb',
              borderColor: '#00c2cb',
              fontWeight: 600,
              borderRadius: 6,
            }}
          >
            Run Pipeline
          </Button>
        </div>
      </Header>

      {/* Main Workspace Body */}
      {isEmptyState ? (
        <Content style={{ flex: 1, overflowY: 'auto', background: 'var(--ant-color-bg-layout, #f8fafc)' }}>
          <DataStudioEmptyState
            onLoadTemplate={(key) => {
              message.success(`Template loaded: ${key}`);
              setIsEmptyState(false);
            }}
            onExitEmptyState={() => setIsEmptyState(false)}
          />
        </Content>
      ) : activeTab === 'connectors' ? (
        <Content style={{ flex: 1, overflowY: 'auto', background: 'var(--ant-color-bg-layout, #f8fafc)' }}>
          <ConnectorHubView />
        </Content>
      ) : activeTab === 'stages' ? (
        <Content style={{ flex: 1, overflowY: 'auto', background: 'var(--ant-color-bg-layout, #f8fafc)' }}>
          <StageAwareTransformPanel />
        </Content>
      ) : activeTab === 'governance' ? (
        <Content style={{ flex: 1, overflowY: 'auto', background: 'var(--ant-color-bg-layout, #f8fafc)' }}>
          <GovernanceSecurityView />
        </Content>
      ) : activeTab === 'semantic' ? (
        <Content style={{ flex: 1, overflowY: 'auto', background: 'var(--ant-color-bg-layout, #f8fafc)' }}>
          <SemanticLayerStudio />
        </Content>
      ) : activeTab === 'lineage' ? (
        <Content style={{ flex: 1, overflowY: 'auto', background: 'var(--ant-color-bg-layout, #f8fafc)' }}>
          <ColumnLineageViewer />
        </Content>
      ) : activeTab === 'catalog' ? (
        <Content style={{ flex: 1, padding: 24, overflowY: 'auto', background: 'var(--ant-color-bg-layout, #f8fafc)' }}>
          <Card title="Apache Iceberg Lakehouse Catalog (Polaris REST Catalog)" style={{ borderRadius: 10 }}>
            <Table
              dataSource={[
                { key: '1', ns: 'finance_prod', table: 'silver_conformed_crm', layer: 'silver', format: 'Iceberg v2', snapshots: 14, size: '42.8 MB', records: '48,498' },
                { key: '2', ns: 'finance_prod', table: 'gold_financial_marts', layer: 'gold', format: 'Iceberg v2', snapshots: 8, size: '1.2 MB', records: '360' },
                { key: '3', ns: 'raw_landing', table: 'bronze_raw_orders', layer: 'bronze', format: 'Parquet', snapshots: 26, size: '118.4 MB', records: '48,520' },
                { key: '4', ns: 'raw_landing', table: 'bronze_raw_customers', layer: 'bronze', format: 'Parquet', snapshots: 26, size: '24.1 MB', records: '12,450' },
              ]}
              pagination={false}
              columns={[
                { title: 'Namespace', dataIndex: 'ns', key: 'ns' },
                { title: 'Table Name', dataIndex: 'table', key: 'table', render: (t) => <Text strong>{t}</Text> },
                { title: 'Medallion Layer', dataIndex: 'layer', key: 'layer', render: (l) => <Tag color={l === 'gold' ? 'gold' : l === 'silver' ? 'blue' : 'orange'}>{l.toUpperCase()}</Tag> },
                { title: 'Format', dataIndex: 'format', key: 'format' },
                { title: 'Snapshots', dataIndex: 'snapshots', key: 'snapshots' },
                { title: 'Storage Size', dataIndex: 'size', key: 'size' },
                { title: 'Row Count', dataIndex: 'records', key: 'records' },
                {
                  title: 'Actions',
                  key: 'actions',
                  render: () => (
                    <Space>
                      <Button size="small">Time Travel</Button>
                      <Button size="small">Schema Evolution</Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Content>
      ) : activeTab === 'observability' ? (
        <Content style={{ flex: 1, padding: 24, overflowY: 'auto', background: 'var(--ant-color-bg-layout, #f8fafc)' }}>
          <Card title="Multi-Table Pipeline Run Observability & Stage Gantt" style={{ borderRadius: 10 }}>
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col span={6}>
                <Statistic title="Total Run Time" value="1.84s" prefix={<ClockCircleOutlined />} />
              </Col>
              <Col span={6}>
                <Statistic title="Total Multi-Stream Rows" value="113,910" valueStyle={{ color: '#10b981' }} />
              </Col>
              <Col span={6}>
                <Statistic title="Quarantined Rows" value="22" valueStyle={{ color: '#f59e0b' }} />
              </Col>
              <Col span={6}>
                <Statistic title="SLA Freshness" value="100%" valueStyle={{ color: '#00c2cb' }} />
              </Col>
            </Row>

            <Title level={5} style={{ fontSize: 14 }}>Parallel Multi-Stream Execution Timeline</Title>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>01. Ingest RDS Postgres: orders, customers, payments, products (Parallel Threads = 4)</span>
                  <span style={{ fontFamily: 'monospace' }}>0.48s (113,910 total rows)</span>
                </div>
                <Progress percent={100} strokeColor="#3b82f6" size="small" showInfo={false} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>02. Bronze Parquet Landing (S3/MinIO Microbatch)</span>
                  <span style={{ fontFamily: 'monospace' }}>0.31s (ZSTD Compressed)</span>
                </div>
                <Progress percent={100} strokeColor="#ea580c" size="small" showInfo={false} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>03. Data Quality Gate (Great Expectations Contract)</span>
                  <span style={{ fontFamily: 'monospace' }}>0.18s (48,498 pass, 22 quarantine)</span>
                </div>
                <Progress percent={99.95} strokeColor="#10b981" size="small" />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>04. DuckDB Multi-Source Conformed Join & Iceberg Upsert</span>
                  <span style={{ fontFamily: 'monospace' }}>0.55s (Merge on order_id)</span>
                </div>
                <Progress percent={100} strokeColor="#0284c7" size="small" showInfo={false} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>05. Gold Mart Materialization & Reverse-ETL Mirror to Snowflake</span>
                  <span style={{ fontFamily: 'monospace' }}>0.32s (360 dimensional records)</span>
                </div>
                <Progress percent={100} strokeColor="#eab308" size="small" showInfo={false} />
              </div>
            </div>
          </Card>
        </Content>
      ) : (
        /* The Flow / Canvas Workspace */
        <Layout style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Top Half: Canvas / Code Split */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
            {/* Visual Canvas Area */}
            {(viewMode === 'visual' || viewMode === 'split') && (
              <div
                style={{
                  flex: viewMode === 'split' ? '1 1 50%' : '1 1 100%',
                  height: '100%',
                  position: 'relative',
                  background: 'var(--ant-color-bg-layout, #f8fafc)',
                }}
              >
                <PipelineFlowCanvas
                  selectedNodeId={selectedNodeId}
                  onSelectNode={(id) => setSelectedNodeId(id)}
                />
              </div>
            )}

            {/* Monaco YAML Code Area */}
            {(viewMode === 'code' || viewMode === 'split') && (
              <div
                style={{
                  flex: viewMode === 'split' ? '1 1 50%' : '1 1 100%',
                  height: '100%',
                  borderLeft: viewMode === 'split' ? '1px solid var(--ant-color-border-secondary, #e2e8f0)' : 'none',
                  background: '#1e1e1e',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div
                  style={{
                    padding: '6px 12px',
                    background: '#2d2d2d',
                    color: '#94a3b8',
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>pipeline_definition.yaml (Multi-Table Ingest & Reverse-ETL)</span>
                  <Tag color="blue" bordered={false}>Declarative Sync</Tag>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <MonacoEditor
                    height="100%"
                    language="yaml"
                    theme="vs-dark"
                    value={yamlContent}
                    onChange={(val) => setYamlContent(val || '')}
                    options={{
                      fontSize: 12,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Right Side Property Inspector */}
            {viewMode === 'visual' && (
              <div
                style={{
                  width: 380,
                  height: '100%',
                  borderLeft: '1px solid var(--ant-color-border-secondary, #e2e8f0)',
                  background: 'var(--ant-color-bg-container, #ffffff)',
                  zIndex: 2,
                }}
              >
                <NodeDetailDrawer
                  nodeId={selectedNodeId}
                  onOpenYaml={() => setViewMode('split')}
                  onSelectTab={(tab) => setBottomTab(tab as any)}
                  onOpenSourceConfig={() => setSourceModalOpen(true)}
                  onOpenDestConfig={() => setDestModalOpen(true)}
                />
              </div>
            )}
          </div>

          {/* Bottom Dock: Live Visual Data Prep & Quality Inspector */}
          <div
            style={{
              height: 275,
              borderTop: '1px solid var(--ant-color-border-secondary, #e2e8f0)',
              background: 'var(--ant-color-bg-container, #ffffff)',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 3,
            }}
          >
            {/* Dock Header Tabs */}
            <div
              style={{
                padding: '0 16px',
                borderBottom: '1px solid var(--ant-color-border-secondary, #f1f5f9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                height: 38,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: selectedNode.accentColor }}>
                  {selectedNode.name}
                </span>

                <Segmented
                  size="small"
                  value={bottomTab}
                  onChange={(val) => setBottomTab(val as any)}
                  options={[
                    { label: `Visual Data Prep (${selectedNode.schema?.length ?? 0} fields profiled)`, value: 'prep', icon: <TableOutlined /> },
                    {
                      label: (
                        <Space size={4}>
                          <span>Quarantine</span>
                          {selectedNode.details.quarantineCount && selectedNode.details.quarantineCount > 0 ? (
                            <Badge count={selectedNode.details.quarantineCount} style={{ backgroundColor: '#f59e0b' }} />
                          ) : null}
                        </Space>
                      ),
                      value: 'quarantine',
                      icon: <SafetyCertificateOutlined />,
                    },
                    { label: 'Execution Logs & Concurrency', value: 'logs', icon: <ClockCircleOutlined /> },
                  ]}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Click column dropdowns for point-and-click data cleaning & type casting
                </Text>
                <Button size="small" icon={<ReloadOutlined />} type="text" />
              </div>
            </div>

            {/* Dock Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: '6px 16px' }} className="aiser-themed-scrollbar">
              {bottomTab === 'prep' ? (
                selectedNode.schema && selectedNode.schema.length > 0 ? (
                  <VisualDataPrepGrid
                    columns={selectedNode.schema}
                    sampleRows={selectedNode.sampleRows}
                    onApplyTransform={(act, col) => {
                      // Live feedback
                    }}
                  />
                ) : (
                  <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                    No tabular schema for this destination node.
                  </div>
                )
              ) : bottomTab === 'quarantine' ? (
                selectedNode.quarantineRows && selectedNode.quarantineRows.length > 0 ? (
                  <Table
                    dataSource={selectedNode.quarantineRows}
                    columns={quarantineColumns}
                    pagination={false}
                    size="small"
                    rowKey={(r, idx) => `q-${idx}`}
                  />
                ) : (
                  <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                    <CheckCircleFilled style={{ color: '#10b981', fontSize: 20, marginBottom: 8 }} />
                    <div>No rows quarantined for this node. All rows passed quality constraints.</div>
                  </div>
                )
              ) : (
                <div style={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6, color: '#475569' }}>
                  <div>[2026-09-11 10:15:00] INFO - Pipeline customer_revenue_gold triggered via scheduler (*/15 * * * *).</div>
                  <div>[2026-09-11 10:15:00] INFO - MultiTableWorkerPool: spawned 4 parallel stream workers for PostgreSQL RDS.</div>
                  <div>[2026-09-11 10:15:00] INFO - Worker-1 (orders): incremental pull (cursor updated_at &gt; &apos;2026-09-11 10:00:00&apos;) → 48,520 rows.</div>
                  <div>[2026-09-11 10:15:00] INFO - Worker-2 (customers): incremental pull → 12,450 rows.</div>
                  <div>[2026-09-11 10:15:00] INFO - Worker-3 (payments): CDC transaction stream → 52,100 events.</div>
                  <div>[2026-09-11 10:15:00] INFO - Worker-4 (products): full refresh snapshot → 840 rows.</div>
                  <div>[2026-09-11 10:15:01] INFO - BronzeWriter: written 4 Parquet partitions to s3://aicser-lake/bronze/.</div>
                  <div>[2026-09-11 10:15:01] WARN - QualityGate: 22 rows failed rule &apos;positive_order_amount&apos;. Quarantined with tombstone.</div>
                  <div>[2026-09-11 10:15:02] INFO - SilverTransform: executed multi-table join (Orders + Customers + Payments). Upserting 48,498 rows to Iceberg finance_prod.silver_conformed_crm.</div>
                  <div>[2026-09-11 10:15:02] INFO - GoldAggregation: materialized 360 dimensional records. GenBI semantic grounding updated.</div>
                  <div>[2026-09-11 10:15:02] INFO - ReverseETL: mirrored 360 rows to Snowflake ANALYTICS.FINANCE.MRR_SUMMARY.</div>
                  <div style={{ color: '#10b981' }}>[2026-09-11 10:15:02] SUCCESS - Multi-stream pipeline completed in 1.84s. All 4 tables synchronized.</div>
                </div>
              )}
            </div>
          </div>
        </Layout>
      )}

      {/* Source Multi-Table Configuration Modal */}
      <SourceConfigModal
        open={sourceModalOpen}
        onCancel={() => setSourceModalOpen(false)}
        onSave={() => setSourceModalOpen(false)}
      />

      {/* Destination Configuration Modal */}
      <DestinationConfigModal
        open={destModalOpen}
        onCancel={() => setDestModalOpen(false)}
        onSave={() => setDestModalOpen(false)}
      />

      {/* Architecture Audit & Critique Modal */}
      <Modal
        title="Comprehensive Audit, Critique & Consolidation Plan"
        open={critiqueModalOpen}
        onCancel={() => setCritiqueModalOpen(false)}
        width={920}
        footer={[
          <Button key="close" type="primary" onClick={() => setCritiqueModalOpen(false)}>
            Close
          </Button>,
        ]}
      >
        <div style={{ maxHeight: '68vh', overflowY: 'auto', paddingRight: 8 }} className="aiser-themed-scrollbar">
          <Title level={4} style={{ marginTop: 0 }}>1. Multi-Table & Multi-Source Execution Strategy</Title>
          <Paragraph>
            In production enterprise environments, connecting to a PostgreSQL or MySQL source involves tens or hundreds of tables.
            Running a pipeline per table manually causes administrative nightmare. Running the entire DB as an opaque blackbox prevents granular transforms.
          </Paragraph>
          <Paragraph>
            <strong>The Solution:</strong> <em>Single Connection, Multi-Stream Container Node</em>. The connection introspects all tables in one go.
            Users select which tables to replicate via a multi-stream grid, set individual sync modes (Incremental Watermark, CDC, Snapshot), and execute in parallel microbatches.
          </Paragraph>

          <Title level={4}>2. Visual Data Prep on Preview (Point-and-Click)</Title>
          <Paragraph>
            Data engineers and non-technical users can interact directly with the bottom preview grid:
          </Paragraph>
          <ul style={{ fontSize: 13, lineHeight: 1.8, color: '#334155' }}>
            <li><strong>Column Quality Bars:</strong> Instant breakdown of Valid %, Null %, and Outlier/Invalid %.</li>
            <li><strong>Value Distribution Histograms:</strong> Top value frequencies and spread previewed in each column header.</li>
            <li><strong>Interactive Transformation Palette:</strong> Click any column to strip currency, trim whitespace, cast types, fill nulls, or attach data contracts without writing code.</li>
          </ul>

          <Title level={4}>3. Reverse-ETL & Full Industry Parity</Title>
          <Paragraph>
            Unlike the legacy implementation which forced destination writes to internal Iceberg only, this architecture introduces
            <strong>Reverse-ETL</strong> to push curated Gold aggregates directly to Snowflake, BigQuery, ClickHouse, PowerBI, and GenBI AI agents.
          </Paragraph>
        </div>
      </Modal>
    </Layout>
  );
}
