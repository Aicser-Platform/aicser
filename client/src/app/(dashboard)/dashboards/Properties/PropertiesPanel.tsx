'use client';

import React, { useState, useEffect } from 'react';
import { Tabs, Input, Select, Button, Tooltip } from 'antd';
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
import { getDashboardFieldDragData, isDashboardFieldDrag } from '../utils/dashboardFieldDrag';
import './PropertiesPanel.css';

interface PropertiesPanelProps {
  selectedWidget: any;
  selectedWidgetId: string | null;
  widgets: any[];
  setWidgets: (next: any) => void;
  removeWidget: (id: string) => void;
  isCollapsed: boolean;
  isDesigner?: boolean;
  // Dashboard pages — passed through to ChartSpecificFields (analytics tab)
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
    applyDroppedField,
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
  // Slicer-specific pending state
  const [pendingSlicerField, setPendingSlicerField] = useState<string | undefined>(undefined);
  const [pendingSlicerMode, setPendingSlicerMode] = useState<string>('single');

  const isSlicer = selectedWidget?.chartType === 'slicer';

  // Sync pending state when widget selection changes
  useEffect(() => {
    if (!selectedWidget) return;
    setPendingTitle(selectedWidget.title || '');
    setPendingChartType(selectedWidget.chartType || 'bar');
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

    // Only commit title (chart type is applied immediately on click)
    if (pendingTitle !== selectedWidget.title) {
      updateWidgetRoot('title', pendingTitle);
    }
  };

  // ── Build tab ────────────────────────────────────────────────────────────────
  const buildTab = (
    <div className="properties-panel-body">
      {!hasWidget ? (
        <div className="pp-empty-state">Select a widget to edit its properties</div>
      ) : (
        <>
          {/* Title */}
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
                <div
                  className="pp-field-drop-shell"
                  onDragOver={(event) => {
                    if (!isDashboardFieldDrag(event.dataTransfer)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(event) => {
                    const field = getDashboardFieldDragData(event.dataTransfer);
                    if (!field) return;
                    event.preventDefault();
                    setPendingSlicerField(field.columnName);
                    applyDroppedField('slicerField', field);
                  }}
                >
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
                        ? 'Loading columns...'
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
                        onClick={() => {
                          setPendingChartType(type);
                          // Commit chart type immediately (no data change, just visual)
                          updateWidgetRoot('chartType', type);
                        }}
                        aria-label={label}
                      >
                        {icon}
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </div>

              {/* Full field mapping — renders the correct fields for each chart type */}
              <ChartSpecificFields
                chartType={selectedWidget.chartType || pendingChartType || 'bar'}
                chartQuery={selectedWidget.chartQuery || {}}
                selectedWidget={selectedWidget}
                selectedTableColumns={selectedTableColumns || []}
                isLoading={schemaLoading}
                onUpdateChartQuery={updateChartQuery}
                onFieldDrop={applyDroppedField}
                chartOptions={selectedWidget.chartOptions || {}}
                onUpdateChartOption={(key, val) =>
                  updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: val })
                }
                mode="mapping"
              />
            </>
          )}
        </>
      )}
    </div>
  );

  // ── Format tab ───────────────────────────────────────────────────────────────
  const formatTab = (
    <div className="properties-panel-body">
      {!hasWidget ? (
        <div className="pp-empty-state">Select a widget to edit its properties</div>
      ) : isSlicer ? (
        <div style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 12, padding: 8 }}>
          Format options not available for slicers.
        </div>
      ) : (
        <>
          <ChartSpecificFields
            chartType={selectedWidget.chartType || 'bar'}
            chartQuery={selectedWidget.chartQuery || {}}
            selectedWidget={selectedWidget}
            selectedTableColumns={selectedTableColumns || []}
            isLoading={schemaLoading}
            onUpdateChartQuery={updateChartQuery}
            onFieldDrop={applyDroppedField}
            chartOptions={selectedWidget.chartOptions || {}}
            onUpdateChartOption={(key, val) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: val })
            }
            onUpdateChartOptions={(updates) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), ...updates })
            }
            mode="customize"
          />
          <ChartSpecificFields
            chartType={selectedWidget.chartType || 'bar'}
            chartQuery={selectedWidget.chartQuery || {}}
            selectedWidget={selectedWidget}
            selectedTableColumns={selectedTableColumns || []}
            isLoading={schemaLoading}
            onUpdateChartQuery={updateChartQuery}
            onFieldDrop={applyDroppedField}
            chartOptions={selectedWidget.chartOptions || {}}
            onUpdateChartOption={(key, val) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: val })
            }
            onUpdateChartOptions={(updates) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), ...updates })
            }
            mode="colors"
          />
          <ChartOptions
            chartType={selectedWidget.chartType || 'bar'}
            chartOptions={selectedWidget.chartOptions || {}}
            chartQuery={selectedWidget.chartQuery || {}}
            onUpdateChartOption={(key, value) =>
              updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: value })
            }
          />
        </>
      )}
    </div>
  );

  // ── Filters tab — unchanged ──────────────────────────────────────────────────
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

  // ── Analytics tab ────────────────────────────────────────────────────────────
  const analyticsTab = (
    <div className="properties-panel-body">
      {!hasWidget || isSlicer ? (
        <div className="pp-empty-state">
          {isSlicer ? 'Analytics not applicable to slicers.' : 'Select a widget to edit its properties'}
        </div>
      ) : (
        <ChartSpecificFields
          chartType={selectedWidget.chartType || 'bar'}
          chartQuery={selectedWidget.chartQuery || {}}
          selectedWidget={selectedWidget}
          selectedTableColumns={selectedTableColumns || []}
          isLoading={schemaLoading}
          onUpdateChartQuery={updateChartQuery}
          onFieldDrop={applyDroppedField}
          chartOptions={selectedWidget.chartOptions || {}}
          onUpdateChartOption={(key, val) =>
            updateWidgetRoot('chartOptions', { ...(selectedWidget.chartOptions || {}), [key]: val })
          }
          mode="advanced"
          dashboardPages={dashboardPages}
        />
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
          { key: 'build',     label: 'Build',     children: buildTab },
          { key: 'format',    label: 'Format',    children: formatTab },
          { key: 'filters',   label: 'Filters',   children: filtersTab },
          { key: 'analytics', label: 'Analytics', children: analyticsTab },
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
