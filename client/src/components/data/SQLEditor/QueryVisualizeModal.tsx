'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Radio, Select, Input, Space, Typography, Alert, Divider } from 'antd';
import {
  DashboardOutlined,
  LineChartOutlined,
  ThunderboltOutlined,
  CameraOutlined,
} from '@ant-design/icons';
import { DashboardLibrarySelect } from '@/app/(dashboard)/dashboards/components/DashboardLibrarySelect';
import {
  type BindColumn,
  type BindDataMode,
  type BindTarget,
  buildChartDataFromRows,
  inferChartMapping,
} from '@/app/(dashboard)/dashboards/utils/queryBindBridge';
import { X_GRAIN_OPTIONS } from '@/app/(dashboard)/dashboards/Properties/PropertiesPanelConfig';
import { WidgetPreview } from '@/app/(dashboard)/dashboards/widgets/WidgetPreview';
import type { WidgetInstance } from '@/app/(dashboard)/dashboards/stores/dashboardStoreTypes';
import {
  chartTypeSelectOptions,
  listDashboardVisualizeChartTypes,
  SHARED_CHART_TYPE_ORDER,
} from '@/components/charts/chartTypeCatalog';
import { getWidgetPropertyProfile } from '@/app/(dashboard)/dashboards/Properties/widgetPropertyProfile';
import { CHART_TYPE_CONFIGS } from '@/app/(dashboard)/dashboards/Properties/PropertiesPanelConfig';

const { Text, Title } = Typography;

export type QueryVisualizeModalValues = {
  target: BindTarget;
  dashboardId?: string;
  chartType: string;
  dataMode: BindDataMode;
  title: string;
  xField?: string;
  yFields: string[];
  /** Optional legend / break-by dimension (single measure only) */
  groupField?: string;
  /** Date bucketing for X */
  xGrain?: string;
  /** Extra drill hierarchy dimensions */
  drillPath?: string[];
};

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: (values: QueryVisualizeModalValues) => void;
  confirming?: boolean;
  defaultTitle?: string;
  hasResultRows?: boolean;
  projectId?: string | number | null;
  /** Current query result rows for live preview */
  resultRows?: Array<Record<string, unknown>>;
  /** Discovered / inferred columns */
  columns?: BindColumn[];
};

const FALLBACK_CHART_TYPES = chartTypeSelectOptions(SHARED_CHART_TYPE_ORDER);

/**
 * Metabase / Power BI style: preview + map fields + pin to dashboard / designer.
 */
export function QueryVisualizeModal({
  open,
  onCancel,
  onConfirm,
  confirming,
  defaultTitle,
  hasResultRows,
  projectId,
  resultRows = [],
  columns = [],
}: Props) {
  const [target, setTarget] = useState<BindTarget>('dashboard');
  const [dashboardId, setDashboardId] = useState<string | undefined>();
  const [chartType, setChartType] = useState('bar');
  const [dataMode, setDataMode] = useState<BindDataMode>('live');
  const [title, setTitle] = useState(defaultTitle || 'Query chart');
  const [xField, setXField] = useState<string | undefined>();
  const [yFields, setYFields] = useState<string[]>([]);
  const [groupField, setGroupField] = useState<string | undefined>();
  const [xGrain, setXGrain] = useState<string | undefined>();
  const [drillPath, setDrillPath] = useState<string[]>([]);

  const columnOptions = useMemo(
    () => columns.map((c) => ({ value: c.name, label: `${c.name}${c.type && c.type !== 'unknown' ? ` (${c.type})` : ''}` })),
    [columns],
  );

  const chartTypeOptions = useMemo(() => {
    const available = listDashboardVisualizeChartTypes(resultRows);
    return available.length ? chartTypeSelectOptions(available) : FALLBACK_CHART_TYPES;
  }, [resultRows]);

  const mappingFields = CHART_TYPE_CONFIGS[chartType]?.fields || [];
  const isMetricOnly =
    chartType === 'stat' ||
    chartType === 'gauge' ||
    getWidgetPropertyProfile(chartType).kind === 'kpi';
  const yMax =
    mappingFields.find((f) => f.key === 'yMetrics')?.maxCount ??
    (['funnel', 'treemap', 'waterfall', 'bullet', 'geo', 'heatmap'].includes(chartType) ? 1 : undefined);
  const singleY = isMetricOnly || yMax === 1;
  const showCategory = !isMetricOnly && chartType !== 'scatter';
  const showLegendBreak =
    !isMetricOnly &&
    chartType !== 'table' &&
    yFields.length <= 1 &&
    mappingFields.some((f) => f.key === 'groupField' || f.key === 'legend');
  const showDrill =
    !isMetricOnly && mappingFields.some((f) => f.key === 'drillPath' || f.key === 'xGrain');
  const showDateGrain = showCategory && Boolean(xField) && mappingFields.some((f) => f.key === 'xGrain');

  useEffect(() => {
    if (!chartTypeOptions.some((o) => o.value === chartType) && chartTypeOptions[0]) {
      setChartType(chartTypeOptions[0].value);
    }
  }, [chartTypeOptions, chartType]);

  useEffect(() => {
    if (singleY && yFields.length > 1) {
      setYFields(yFields.slice(0, 1));
    }
  }, [singleY, yFields]);

  // Reset mapping when modal opens / columns change
  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle || 'Query chart');
    setDataMode('live');
    const inferred = inferChartMapping(columns, chartType, {
      sampleRows: resultRows,
      preferNoneAggregation: true,
    });
    setXField(inferred.x);
    setYFields(inferred.yMetrics.map((m) => m.field).filter(Boolean));
    setGroupField(inferred.groupField);
    setXGrain(undefined);
    setDrillPath([]);
  }, [open, defaultTitle, columns]);

  useEffect(() => {
    if (!open) return;
    const inferred = inferChartMapping(columns, chartType, {
      sampleRows: resultRows,
      preferNoneAggregation: true,
    });
    setXField((prev) => (prev && columns.some((c) => c.name === prev) ? prev : inferred.x));
    setYFields((prev) => {
      const valid = prev.filter((f) => columns.some((c) => c.name === f));
      return valid.length ? valid : inferred.yMetrics.map((m) => m.field).filter(Boolean);
    });
    setGroupField((prev) => {
      if (prev && columns.some((c) => c.name === prev)) return prev;
      return inferred.groupField;
    });
  }, [chartType, columns, open]);

  // Multi-Y clears legend (XOR)
  useEffect(() => {
    if (yFields.length > 1 && groupField) setGroupField(undefined);
  }, [yFields, groupField]);

  const previewWidget = useMemo((): WidgetInstance | null => {
    if (!open) return null;
    const yMetrics = yFields.map((field) => ({
      field,
      aggregation: 'none' as const,
    }));
    const chartData =
      resultRows.length > 0
        ? buildChartDataFromRows(resultRows.slice(0, 200), {
            chartType,
            x: xField,
            groupField: yFields.length <= 1 ? groupField : undefined,
            yMetrics,
          })
        : { x: [], y: [], series: [] };

    return {
      id: 'visualize-preview',
      title: title || 'Preview',
      chartType: chartType as any,
      chartQuery: {
        x: xField,
        xGrain: xGrain || undefined,
        yMetrics,
        ...(yFields.length <= 1 && groupField
          ? { groupField, legend: groupField }
          : {}),
        ...(drillPath.length ? { drillPath } : {}),
        sortBy: 'x',
      },
      chartOptions: { showLegend: true, showDataLabel: false },
      chartData: chartData as any,
    };
  }, [open, resultRows, chartType, xField, yFields, groupField, xGrain, drillPath, title]);

  const canSubmit = useMemo(() => {
    if (!title.trim()) return false;
    if (target === 'dashboard' && !dashboardId) return false;
    if (chartType === 'table') return true;
    if (chartType !== 'stat' && chartType !== 'gauge' && !xField && columns.length > 0) return false;
    if (!yFields.length && columns.length > 0) return false;
    return true;
  }, [target, title, dashboardId, xField, yFields, columns.length, chartType]);

  return (
    <Modal
      open={open}
      title="Visualize query"
      okText={target === 'dashboard' ? 'Add to dashboard' : 'Open in Chart Designer'}
      okButtonProps={{ disabled: !canSubmit, loading: confirming }}
      onCancel={onCancel}
      onOk={() =>
          onConfirm({
          target,
          dashboardId: target === 'dashboard' ? dashboardId : undefined,
          chartType,
          dataMode,
          title: title.trim() || 'Query chart',
          xField,
          yFields,
          groupField: yFields.length <= 1 ? groupField : undefined,
          xGrain: xGrain || undefined,
          drillPath: drillPath.length ? drillPath : undefined,
        })
      }
      width={920}
      destroyOnHidden
      styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 340px) 1fr',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              Destination
            </Text>
            <Radio.Group
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              optionType="button"
              buttonStyle="solid"
              style={{ width: '100%', display: 'flex' }}
            >
              <Radio.Button value="dashboard" style={{ flex: 1, textAlign: 'center' }}>
                <DashboardOutlined /> Dashboard
              </Radio.Button>
              <Radio.Button value="chart-designer" style={{ flex: 1, textAlign: 'center' }}>
                <LineChartOutlined /> Designer
              </Radio.Button>
            </Radio.Group>
          </div>

          {target === 'dashboard' && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                Dashboard
              </Text>
              <DashboardLibrarySelect
                value={dashboardId ?? null}
                onChange={(id) => setDashboardId(id || undefined)}
                placeholder="Select dashboard"
                defaultFacet="recent"
              />
            </div>
          )}

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              Widget title
            </Text>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              Chart type
            </Text>
            <Select style={{ width: '100%' }} value={chartType} onChange={setChartType} options={chartTypeOptions} />
          </div>

          <Divider style={{ margin: '4px 0' }} />

          {showCategory && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                Category (X-axis)
              </Text>
              <Select
                style={{ width: '100%' }}
                allowClear
                placeholder="Select column"
                value={xField}
                onChange={setXField}
                options={columnOptions}
                showSearch
                optionFilterProp="label"
              />
            </div>
          )}

          {chartType === 'scatter' && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                X measure
              </Text>
              <Select
                style={{ width: '100%' }}
                allowClear
                placeholder="Select numeric column"
                value={xField}
                onChange={setXField}
                options={columnOptions}
                showSearch
                optionFilterProp="label"
              />
            </div>
          )}

          {showDateGrain && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                Date grain
              </Text>
              <Select
                style={{ width: '100%' }}
                allowClear
                placeholder="None (raw values)"
                value={xGrain || undefined}
                onChange={(v) => setXGrain(v || undefined)}
                options={X_GRAIN_OPTIONS.filter((o) => o.value !== '').map((o) => ({
                  value: String(o.value),
                  label: o.label,
                }))}
              />
            </div>
          )}

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              {isMetricOnly ? 'Metric' : singleY ? 'Value' : 'Values (Y-axis)'}
            </Text>
            <Select
              style={{ width: '100%' }}
              mode={singleY ? undefined : 'multiple'}
              placeholder="Select measure column(s)"
              value={singleY ? yFields[0] : yFields}
              onChange={(v) => setYFields(Array.isArray(v) ? v : v ? [v] : [])}
              options={columnOptions}
              showSearch
              optionFilterProp="label"
            />
          </div>

          {showLegendBreak && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                Legend (break by)
              </Text>
              <Select
                style={{ width: '100%' }}
                allowClear
                placeholder="Optional second dimension"
                value={groupField}
                onChange={(v) => setGroupField(v)}
                options={columnOptions.filter(
                  (o) => o.value !== xField && !yFields.includes(o.value),
                )}
                showSearch
                optionFilterProp="label"
              />
            </div>
          )}

          {showDrill && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                Additional dimensions (drill)
              </Text>
              <Select
                style={{ width: '100%' }}
                mode="multiple"
                allowClear
                placeholder="Optional drill hierarchy"
                value={drillPath}
                onChange={(v) => setDrillPath(v || [])}
                options={columnOptions.filter(
                  (o) =>
                    o.value !== xField &&
                    o.value !== groupField &&
                    !yFields.includes(o.value),
                )}
                showSearch
                optionFilterProp="label"
              />
            </div>
          )}

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              Data mode
            </Text>
            <Radio.Group value={dataMode} onChange={(e) => setDataMode(e.target.value)}>
              <Space direction="vertical" size={4}>
                <Radio value="live">
                  <ThunderboltOutlined /> Live — refresh re-runs SQL
                </Radio>
                <Radio value="snapshot" disabled={!hasResultRows}>
                  <CameraOutlined /> Snapshot — freeze current rows
                </Radio>
              </Space>
            </Radio.Group>
            {!hasResultRows && (
              <Alert
                style={{ marginTop: 8 }}
                type="info"
                showIcon
                message="Run the query for preview and Snapshot mode."
              />
            )}
          </div>
        </Space>

        <div
          style={{
            border: '1px solid var(--ant-color-border)',
            borderRadius: 8,
            padding: 12,
            minHeight: 320,
            background: 'var(--ant-color-bg-container)',
          }}
        >
          <Title level={5} style={{ margin: '0 0 8px', fontSize: 13 }}>
            Preview
          </Title>
          {!resultRows.length ? (
            <div style={{ color: 'var(--ant-color-text-secondary)', fontSize: 13, padding: 24, textAlign: 'center' }}>
              Run your query to see a live preview here.
            </div>
          ) : previewWidget ? (
            <div style={{ height: 300 }}>
              <WidgetPreview widget={previewWidget} readOnly compactPreview minHeight={280} />
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

export default QueryVisualizeModal;
