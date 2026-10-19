'use client';

import React, { useMemo, useState } from 'react';
import { Button, Modal, Select, Space, Typography, message } from 'antd';
import { BarChartOutlined, PushpinOutlined, SlidersOutlined } from '@ant-design/icons';
import type { Model } from '@ironcalc/workbook';
import type { DataRange } from '@/services/workbookService';
import { extractSheetTableDatasets } from './sheetTableExtract';
import { SharedChartRenderer } from '@/components/charts/SharedChartRenderer';
import { AddChartToDashboardModal } from '@/components/charts/AddChartToDashboardModal';
import { useAddChartToDashboard } from '@/hooks/useAddChartToDashboard';
import { buildChatMessagePinSource } from '@/components/charts/buildChatChartPinPayload';
import { useOpenChartDesignerFromChat } from '@/hooks/useOpenChartDesignerFromChat';

const { Text } = Typography;

export interface SheetChartModalProps {
  open: boolean;
  onClose: () => void;
  model: Model | null;
  ranges: DataRange[];
  sheetName: (sheet: number) => string;
  workbookId: string;
  workbookTitle: string;
}

export function SheetChartModal({
  open,
  onClose,
  model,
  ranges,
  sheetName,
  workbookId,
  workbookTitle,
}: SheetChartModalProps) {
  // Extract all available tabular datasets from the workbook
  const datasets = useMemo(() => {
    return extractSheetTableDatasets(model, ranges, sheetName).map((d) => ({
      id: d.id,
      name: d.name,
      columns: d.columns,
      rows: d.rows.map((row) => {
        const item: Record<string, unknown> = {};
        d.columns.forEach((col, i) => { item[col] = row[i]; });
        return item;
      }),
    }));
  }, [model, ranges, sheetName]);

  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const activeDataset = useMemo(() => {
    return datasets.find((d) => d.id === selectedDatasetId) || datasets[0] || null;
  }, [datasets, selectedDatasetId]);

  const [chartType, setChartType] = useState<string>('bar');
  const [xAxisField, setXAxisField] = useState<string>('');
  const [yAxisField, setYAxisField] = useState<string>('');

  React.useEffect(() => {
    if (activeDataset && activeDataset.columns.length > 0) {
      if (!xAxisField || !activeDataset.columns.includes(xAxisField)) {
        setXAxisField(activeDataset.columns[0]);
      }
      if (!yAxisField || !activeDataset.columns.includes(yAxisField)) {
        const numCol = activeDataset.columns.find((c) =>
          activeDataset.rows.some((r) => typeof r[c] === 'number')
        );
        setYAxisField(numCol || activeDataset.columns[1] || activeDataset.columns[0]);
      }
    }
  }, [activeDataset, xAxisField, yAxisField]);

  // Build chart series and visual data
  const chartData = useMemo(() => {
    if (!activeDataset || !xAxisField || !yAxisField) return null;

    const categories = activeDataset.rows.map((r) => String(r[xAxisField] ?? ''));
    const values = activeDataset.rows.map((r) => {
      const v = r[yAxisField];
      return typeof v === 'number' ? v : Number(v) || 0;
    });

    return {
      x: categories,
      y: values,
      series: [
        {
          name: yAxisField,
          data: values,
          type: chartType === 'area' ? 'line' : chartType,
          areaStyle: chartType === 'area' ? {} : undefined,
        },
      ],
    };
  }, [activeDataset, xAxisField, yAxisField, chartType]);

  // Dashboard Pinning
  const addToDashboard = useAddChartToDashboard();
  const { openInDesigner, opening: openingDesigner } = useOpenChartDesignerFromChat();

  const handlePin = async () => {
    if (!chartData) return;
    const pinSource = buildChatMessagePinSource({
      id: `sheet-${workbookId}-${Date.now()}`,
      echartsConfig: {
        title: { text: `${yAxisField} by ${xAxisField}` },
        series: chartData.series,
        xAxis: { type: 'category', data: chartData.x },
        yAxis: { type: 'value' },
      },
      title: `${yAxisField} by ${xAxisField} (${workbookTitle})`,
      queryResult: activeDataset?.rows,
    });
    await addToDashboard.openModal(pinSource, null);
  };

  const handleOpenDesigner = async () => {
    if (!chartData) return;
    const pinSource = buildChatMessagePinSource({
      id: `sheet-${workbookId}-${Date.now()}`,
      echartsConfig: {
        title: { text: `${yAxisField} by ${xAxisField}` },
        series: chartData.series,
        xAxis: { type: 'category', data: chartData.x },
        yAxis: { type: 'value' },
      },
      title: `${yAxisField} by ${xAxisField} (${workbookTitle})`,
      queryResult: activeDataset?.rows,
    });
    await openInDesigner({
      source: pinSource,
      title: `${yAxisField} by ${xAxisField} (${workbookTitle})`,
    });
  };

  return (
    <>
      <Modal
        open={open}
        title={
          <Space>
            <BarChartOutlined />
            <span>Sheet Visualizer & Charting</span>
          </Space>
        }
        onCancel={onClose}
        width={820}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button
              icon={<SlidersOutlined />}
              onClick={handleOpenDesigner}
              loading={openingDesigner}
              disabled={!chartData}
            >
              Open in Chart Designer
            </Button>
            <Space>
              <Button onClick={onClose}>Close</Button>
              <Button type="primary" icon={<PushpinOutlined />} onClick={handlePin} disabled={!chartData}>
                Pin to Dashboard
              </Button>
            </Space>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Data Source Range</Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                value={activeDataset?.id}
                onChange={(id) => setSelectedDatasetId(id)}
                options={datasets.map((d) => ({ label: d.name, value: d.id }))}
                placeholder="Select dataset"
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Chart Type</Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                value={chartType}
                onChange={setChartType}
                options={[
                  { label: 'Bar Chart', value: 'bar' },
                  { label: 'Line Chart', value: 'line' },
                  { label: 'Area Chart', value: 'area' },
                  { label: 'Pie Chart', value: 'pie' },
                  { label: 'Scatter Plot', value: 'scatter' },
                ]}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>X Axis (Category)</Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                value={xAxisField}
                onChange={setXAxisField}
                options={activeDataset?.columns.map((c) => ({ label: c, value: c }))}
                placeholder="Select dimension"
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Y Axis (Metric)</Text>
              <Select
                style={{ width: '100%', marginTop: 4 }}
                value={yAxisField}
                onChange={setYAxisField}
                options={activeDataset?.columns.map((c) => ({ label: c, value: c }))}
                placeholder="Select metric"
              />
            </div>
          </div>

          {chartData ? (
            <div style={{ height: 350, border: '1px solid var(--ant-color-border-secondary)', borderRadius: 8, padding: 12 }}>
              <SharedChartRenderer
                chartType={chartType}
                chartData={chartData}
                chartOptions={{ title: `${yAxisField} by ${xAxisField}` }}
                minHeight={350}
              />
            </div>
          ) : (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
              Select columns above to render a chart from this sheet.
            </div>
          )}
        </div>
      </Modal>

      <AddChartToDashboardModal
        open={addToDashboard.open}
        dashboards={addToDashboard.modalDashboards}
        targetDashboardId={addToDashboard.targetDashboardId}
        onTargetChange={addToDashboard.setTargetDashboardId}
        creatingNew={addToDashboard.creatingNew}
        newDashboardName={addToDashboard.newDashboardName}
        onNewDashboardNameChange={addToDashboard.setNewDashboardName}
        onConfirm={() => void addToDashboard.confirmAdd()}
        onCancel={addToDashboard.closeModal}
        confirmLoading={addToDashboard.submitting}
        subtitle={`From Sheet: ${workbookTitle}`}
      />
    </>
  );
}
