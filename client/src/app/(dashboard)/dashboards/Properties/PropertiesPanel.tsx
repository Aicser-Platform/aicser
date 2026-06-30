'use client';

import React, { useState, useEffect } from 'react';
import { Tabs, Input, Select, Checkbox, Button, Tooltip } from 'antd';
import {
  LineChartOutlined,
  BarChartOutlined,
  PieChartOutlined,
  TableOutlined,
  NumberOutlined,
  AreaChartOutlined,
  RadarChartOutlined,
  HeatMapOutlined,
} from '@ant-design/icons';
import { useWidgetProperties } from '../hooks/useWidgetProperties';
import { ChartOptions } from './ChartOptions';
import { ChartSpecificFields } from './ChartSpecificFields';
import type { DashboardFilter } from '@/types/dashboard';
import type { RuntimeFilter } from '../utils/filterOperators';
import './PropertiesPanel.css';

interface PropertiesPanelProps {
  selectedWidget: any;
  selectedWidgetId: string | null;
  widgets: any[];
  setWidgets: (next: any) => void;
  removeWidget: (id: string) => void;
  isCollapsed: boolean;
  isDesigner?: boolean;
  // Dashboard pages — passed through to ChartSpecificFields (advanced tab)
  dashboardPages?: { id: string; name: string }[];
  // Filters tab props
  globalFiltersConfig?: DashboardFilter[];
  pageFiltersConfig?: DashboardFilter[];
  runtimeFilters?: RuntimeFilter[];
  onRuntimeFiltersChange?: (filters: RuntimeFilter[]) => void;
}

const CHART_TYPES: { type: string; icon: React.ReactNode; label: string }[] = [
  { type: 'line', icon: <LineChartOutlined />, label: 'Line' },
  { type: 'bar', icon: <BarChartOutlined />, label: 'Bar' },
  { type: 'area', icon: <AreaChartOutlined />, label: 'Area' },
  { type: 'pie', icon: <PieChartOutlined />, label: 'Pie' },
  { type: 'donut', icon: <PieChartOutlined />, label: 'Donut' },
  { type: 'table', icon: <TableOutlined />, label: 'Table' },
  { type: 'stat', icon: <NumberOutlined />, label: 'Stat' },
  { type: 'scatter', icon: <RadarChartOutlined />, label: 'Scatter' },
  { type: 'heatmap', icon: <HeatMapOutlined />, label: 'Heatmap' },
];

const DEFAULT_PALETTE = ['#00c2cb', '#5b8ff9', '#5ad8a6', '#f6bd16', '#e8684a'];

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedWidget,
  selectedWidgetId,
  widgets,
  setWidgets,
  isCollapsed,
  removeWidget,
  isDesigner = false,
  dashboardPages = [],
  globalFiltersConfig = [],
  pageFiltersConfig = [],
  runtimeFilters = [],
  onRuntimeFiltersChange,
}) => {
  const {
    dataSources,
    selectedTableColumns,
    availableTables,
    handleDataSourceChange,
    isLoading,
    updateWidgetRoot,
    updateChartQuery,
    applyWidgetChanges,
    applySlicerChanges,
    schemaLoading,
  } = useWidgetProperties({ selectedWidget, selectedWidgetId, widgets, setWidgets, isDesigner });

  const dataSourceOptions = (dataSources || []).map((ds: any) => ({
    value: String(ds.id),
    label: ds.name || ds.id,
  }));

  const tableOptions = (availableTables || []).map((t: string) => ({
    value: t,
    label: t,
  }));

  // Local pending state — committed on Apply Changes
  const [pendingTitle, setPendingTitle] = useState<string>('');
  const [pendingChartType, setPendingChartType] = useState<string>('bar');
  const [pendingXAxis, setPendingXAxis] = useState<string | undefined>(undefined);
  const [pendingYAxis, setPendingYAxis] = useState<string | undefined>(undefined);
  const [pendingYAggregation, setPendingYAggregation] = useState<string>('count');
  const [pendingShowLabels, setPendingShowLabels] = useState(false);
  const [pendingShowGridlines, setPendingShowGridlines] = useState(true);
  const [pendingColorPalette, setPendingColorPalette] = useState<string>('');
  // Slicer-specific pending state
  const [pendingSlicerField, setPendingSlicerField] = useState<string | undefined>(undefined);
  const [pendingSlicerMode, setPendingSlicerMode] = useState<string>('single');

  const isSlicer = selectedWidget?.chartType === 'slicer';

  // Sync pending state when widget selection changes
  useEffect(() => {
    if (!selectedWidget) return;
    setPendingTitle(selectedWidget.title || '');
    setPendingChartType(selectedWidget.chartType || 'bar');
    setPendingXAxis(selectedWidget.chartQuery?.x);
    // Prefer yMetrics[0] as the source of truth; fall back to legacy y field
    setPendingYAxis(selectedWidget.chartQuery?.yMetrics?.[0]?.field || selectedWidget.chartQuery?.y);
    setPendingYAggregation(selectedWidget.chartQuery?.yMetrics?.[0]?.aggregation || 'count');
    setPendingShowLabels(selectedWidget.chartOptions?.showDataLabels ?? false);
    setPendingShowGridlines(selectedWidget.chartOptions?.showGridlines ?? true);
    setPendingColorPalette(selectedWidget.chartOptions?.colorPalette || DEFAULT_PALETTE[0]);
    // Slicer
    setPendingSlicerField((selectedWidget.chartQuery as any)?.field || selectedWidget.chartQuery?.x);
    setPendingSlicerMode((selectedWidget.chartQuery as any)?.mode || 'single');
  }, [selectedWidgetId, selectedWidget]);

  const hasWidget = Boolean(selectedWidget && selectedWidgetId);

  // selectedTableColumns is already {label, value, type}[] from useWidgetProperties
  const columnOptions = selectedTableColumns || [];

  const handleApply = () => {
    if (!hasWidget) return;

    if (isSlicer) {
      applySlicerChanges({ title: pendingTitle, field: pendingSlicerField, mode: pendingSlicerMode });
      return;
    }

    // Chart widgets: single atomic update — avoids stale-closure overwrite where
    // calling updateChartQuery('x') then updateChartQuery('y') separately caused
    // the second call to read stale chartQuery and lose the x value.
    applyWidgetChanges({
      title: pendingTitle,
      chartType: pendingChartType,
      x: pendingXAxis,
      y: pendingYAxis,
      yAggregation: pendingYAggregation,
      chartOptions: {
        ...(selectedWidget.chartOptions || {}),
        showDataLabels: pendingShowLabels,
        showGridlines: pendingShowGridlines,
        colorPalette: pendingColorPalette,
      },
    });
  };

  const generalTab = (
    <div className="properties-panel-body">
      {!hasWidget ? (
        <div className="pp-empty-state">Select a widget to edit its properties</div>
      ) : (
        <>
          <div>
            <div className="pp-section-label">Widget Title</div>
            <Input
              value={pendingTitle}
              onChange={(e) => setPendingTitle(e.target.value)}
              placeholder="Widget title"
              size="small"
            />
          </div>

          {/* Data Source selector — required before columns can be picked */}
          <div>
            <div className="pp-section-label">Data Source</div>
            <Select
              size="small"
              style={{ width: '100%' }}
              value={selectedWidget?.dataSourceId ? String(selectedWidget.dataSourceId) : undefined}
              onChange={handleDataSourceChange}
              options={dataSourceOptions}
              placeholder="Select data source"
              loading={isLoading}
              allowClear
              showSearch
              filterOption={(input, opt) =>
                String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </div>

          {/* Table selector — only shown for multi-table sources (Excel with multiple sheets) */}
          {tableOptions.length > 1 && (
            <div>
              <div className="pp-section-label">Table</div>
              <Select
                size="small"
                style={{ width: '100%' }}
                value={(selectedWidget as any)?.chartQuery?.tableName}
                onChange={(val) => updateChartQuery('tableName', val)}
                options={tableOptions}
                placeholder="Select table"
                loading={schemaLoading}
                allowClear
              />
            </div>
          )}

          {isSlicer ? (
            /* ---- Slicer-specific fields ---- */
            <>
              <div>
                <div className="pp-section-label">Filter Field</div>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  value={pendingSlicerField}
                  onChange={setPendingSlicerField}
                  options={columnOptions}
                  placeholder={
                    !selectedWidget?.dataSourceId
                      ? 'Select a data source first'
                      : schemaLoading
                      ? 'Loading columns…'
                      : 'Select filter field'
                  }
                  loading={schemaLoading}
                  allowClear
                  showSearch
                  filterOption={(input, opt) =>
                    String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                />
              </div>

              <div>
                <div className="pp-section-label">Slicer Type</div>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  value={pendingSlicerMode}
                  onChange={setPendingSlicerMode}
                  options={[
                    { label: 'Dropdown (single)', value: 'single' },
                    { label: 'Dropdown (multi-select)', value: 'multi' },
                    { label: 'Tile / Button list', value: 'tile' },
                    { label: 'Date picker', value: 'date' },
                    { label: 'Date range', value: 'dateRange' },
                    { label: 'Numeric range slider', value: 'numericRange' },
                    { label: 'On / Off toggle', value: 'toggle' },
                  ]}
                />
              </div>
            </>
          ) : (
            /* ---- Chart-specific fields ---- */
            <>
              <div>
                <div className="pp-section-label">Chart Type</div>
                <div className="pp-chart-type-row">
                  {CHART_TYPES.map(({ type, icon, label }) => (
                    <Tooltip key={type} title={label} placement="top">
                      <button
                        className={`pp-chart-type-btn${pendingChartType === type ? ' active' : ''}`}
                        onClick={() => setPendingChartType(type)}
                        aria-label={label}
                      >
                        {icon}
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </div>

              <div>
                <div className="pp-section-label">X-Axis</div>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  value={pendingXAxis}
                  onChange={setPendingXAxis}
                  options={columnOptions}
                  placeholder="Select column"
                  loading={schemaLoading}
                  allowClear
                  showSearch
                  filterOption={(input, opt) =>
                    String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                />
              </div>

              <div>
                <div className="pp-section-label">Y-Axis (Values)</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Select
                    size="small"
                    style={{ flex: 1, minWidth: 0 }}
                    value={pendingYAxis}
                    onChange={setPendingYAxis}
                    options={columnOptions}
                    placeholder="Select column"
                    loading={schemaLoading}
                    allowClear
                    showSearch
                    filterOption={(input, opt) =>
                      String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                  <Select
                    size="small"
                    style={{ width: 90, flexShrink: 0 }}
                    value={pendingYAggregation}
                    onChange={setPendingYAggregation}
                    options={[
                      { label: 'Count', value: 'count' },
                      { label: 'Sum', value: 'sum' },
                      { label: 'Avg', value: 'avg' },
                      { label: 'Min', value: 'min' },
                      { label: 'Max', value: 'max' },
                      { label: 'None', value: 'none' },
                    ]}
                  />
                </div>
              </div>

              <div>
                <div className="pp-section-label">Visual Options</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Checkbox
                    checked={pendingShowLabels}
                    onChange={(e) => setPendingShowLabels(e.target.checked)}
                  >
                    Show Data Labels
                  </Checkbox>
                  <Checkbox
                    checked={pendingShowGridlines}
                    onChange={(e) => setPendingShowGridlines(e.target.checked)}
                  >
                    Show Gridlines
                  </Checkbox>
                </div>
              </div>

              <div>
                <div className="pp-section-label">Color Palette</div>
                <div className="pp-palette-row">
                  {DEFAULT_PALETTE.map((color) => (
                    <div
                      key={color}
                      className={`pp-palette-swatch${pendingColorPalette === color ? ' active' : ''}`}
                      style={{ background: color }}
                      title={color}
                      onClick={() => setPendingColorPalette(color)}
                      role="button"
                      tabIndex={0}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );

  const allFilters = [...globalFiltersConfig, ...pageFiltersConfig];

  const filtersTab = (
    <div className="properties-panel-body">
      {/* Page-level Filters */}
      <div>
        <div className="pp-section-label">Page-level Filters</div>
        {allFilters.length === 0 ? (
          <div style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12 }}>
            No page filters configured
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {allFilters.map((filter) => {
              const active = runtimeFilters.find((rf) => rf.field === filter.field);
              const currentValue = active?.value;
              const valueAsArray: string[] = Array.isArray(currentValue)
                ? (currentValue as string[])
                : currentValue != null
                ? [String(currentValue)]
                : [];
              return (
                <div key={filter.field}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--ant-color-text-secondary)',
                      marginBottom: 4,
                    }}
                  >
                    {(filter.name || filter.field).toUpperCase()}
                  </div>
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    placeholder="All"
                    value={valueAsArray.length > 0 ? valueAsArray : undefined}
                    mode="multiple"
                    allowClear
                    onChange={(vals: string[]) => {
                      if (!onRuntimeFiltersChange) return;
                      const others = runtimeFilters.filter((rf) => rf.field !== filter.field);
                      onRuntimeFiltersChange(
                        vals.length > 0
                          ? [...others, { field: filter.field, operator: 'in', value: vals, type: 'simple' as const }]
                          : others,
                      );
                    }}
                    options={[]}
                    notFoundContent={<span style={{ fontSize: 12 }}>Enter values</span>}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Visual-level Filters */}
      {hasWidget && (
        <div>
          <div className="pp-section-label">Visual-level Filters</div>
          <div style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12 }}>
            Visual filters apply only to this widget. Coming in a future release.
          </div>
        </div>
      )}
    </div>
  );

  const advancedTab = (
    <div className="properties-panel-body">
      {!hasWidget ? (
        <div className="pp-empty-state">Select a widget to edit its properties</div>
      ) : (
        <>
          <ChartOptions
            chartType={selectedWidget.chartType || 'bar'}
            chartOptions={selectedWidget.chartOptions || {}}
            chartQuery={selectedWidget.chartQuery || {}}
            onUpdateChartOption={(key: string, value: boolean) => {
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: value });
            }}
          />
          <ChartSpecificFields
            chartType={selectedWidget.chartType || 'bar'}
            chartQuery={selectedWidget.chartQuery || {}}
            selectedWidget={selectedWidget}
            selectedTableColumns={selectedTableColumns || []}
            isLoading={schemaLoading}
            onUpdateChartQuery={updateChartQuery}
            chartOptions={selectedWidget.chartOptions || {}}
            onUpdateChartOption={(key: string, value: unknown) => {
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: value });
            }}
            mode="advanced"
            dashboardPages={dashboardPages}
          />
        </>
      )}
    </div>
  );

  if (isCollapsed) return null;

  return (
    <div className="properties-panel">
      <Tabs
        className="properties-panel-tabs"
        size="small"
        items={[
          { key: 'general', label: 'General', children: generalTab },
          { key: 'filters', label: 'Filters', children: filtersTab },
          { key: 'advanced', label: 'Advanced', children: advancedTab },
        ]}
      />
      <div className="properties-panel-footer">
        <Button
          type="primary"
          block
          size="small"
          disabled={!hasWidget}
          onClick={handleApply}
        >
          Apply Changes
        </Button>
        {hasWidget && (
          <Button
            type="link"
            danger
            block
            size="small"
            onClick={() => removeWidget(selectedWidgetId!)}
          >
            Delete Widget
          </Button>
        )}
      </div>
    </div>
  );
};
