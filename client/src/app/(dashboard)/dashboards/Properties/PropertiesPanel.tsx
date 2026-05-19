'use client';

import React from 'react';
import { useWidgetProperties } from '../hooks/useWidgetProperties';
import { TextInputField, SelectField, CheckboxField, SectionLabel } from './FormFields';
import { ChartSpecificFields } from './ChartSpecificFields';
import { ChartOptions } from './ChartOptions';
import { Alert, Tabs, Collapse, ColorPicker, Button, Divider, Radio, Select } from 'antd';
import {
  RightOutlined,
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  FontColorsOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import {
  CHART_TYPE_CONFIGS,
} from './PropertiesPanelConfig';
import './PropertiesPanel.css';
import { useTranslations } from 'next-intl';

interface PropertiesPanelProps {
  selectedWidget: any;
  selectedWidgetId: string | null;
  widgets: any[];
  setWidgets: (next: any) => void;
  removeWidget: (id: string) => void;
  isCollapsed: boolean;
  isDesigner?: boolean;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedWidget,
  selectedWidgetId,
  widgets,
  setWidgets,
  isCollapsed,
  removeWidget,
  isDesigner = false,
}) => {
  const t = useTranslations('properties_panel');
  const {
    dataSources,
    selectedTableColumns,
    availableTables,
    updateWidgetRoot,
    updateChartQuery,
    handleDataSourceChange,
    isLoading,
    schemaLoading,
  } = useWidgetProperties({ selectedWidget, selectedWidgetId, widgets, setWidgets, isDesigner });

  const chartType = selectedWidget?.chartType || 'bar';
  const chartOptions = selectedWidget?.chartOptions || {};

  const updateChartOption = (key: string, value: any) => {
    // Global block text size should affect all major chart text controls.
    if (key === 'axisLabelFontSize') {
      updateWidgetRoot('chartOptions', {
        ...chartOptions,
        axisLabelFontSize: value,
        hAxisFontSize: value,
        vAxisFontSize: value,
        legendFontSize: value,
      });
      return;
    }

    updateWidgetRoot('chartOptions', { ...chartOptions, [key]: value });
  };

  const updateChartOptions = (updates: Record<string, any>) => {
    updateWidgetRoot('chartOptions', { ...chartOptions, ...updates });
  };

  const showSidebar = !!selectedWidgetId && !!selectedWidget;
  const isText = chartType === 'text';

  const items = [
    {
      key: 'general',
      label: t('general'),
      children: (
        <div className="tab-pane-content">
          <TextInputField
            label={t('title')}
            value={selectedWidget?.title || ''}
            onChange={(value) => updateWidgetRoot('title', value)}
            placeholder={t('widget_title_placeholder')}
          />

          {!isText && (
            <>
              <SelectField
                label="Data Source"
                required={true}
                value={selectedWidget?.dataSourceId || undefined}
                onChange={handleDataSourceChange}
                options={dataSources.map((ds: any) => ({ label: ds.name, value: ds.id }))}
                placeholder={
                  isLoading
                    ? 'Loading data sources...'
                    : dataSources.length === 0
                      ? 'No data sources available'
                      : 'Choose a data source...'
                }
                disabled={false}
                isLoading={isLoading}
                showSearch={true}
              />

              {availableTables &&
                availableTables.length > 0 &&
                !(availableTables.length === 1 && availableTables[0] === 'data') && (
                  <SelectField
                    label={t('table')}
                    required={true}
                    value={selectedWidget?.chartQuery?.tableName || availableTables[0]}
                    onChange={(value) => updateChartQuery('tableName', value)}
                    options={availableTables.map((t: string) => ({ label: t, value: t }))}
                    placeholder={t('choose_table_placeholder')}
                    isLoading={schemaLoading}
                    showSearch={true}
                  />
                )}

              {/* Show helper message when no data sources are available */}
              {!isLoading && dataSources.length === 0 && (
                <Alert
                  message={t('no_data_sources')}
                  description={t('no_data_sources_desc')}
                  type="info"
                  showIcon
                  style={{ marginTop: 8, marginBottom: 16 }}
                />
              )}

              <SelectField
                label="Chart Type"
                value={chartType}
                onChange={(val) => updateWidgetRoot('chartType', val)}
                options={Object.entries(CHART_TYPE_CONFIGS).map(([val, cfg]) => ({
                  label: cfg.label,
                  value: val,
                }))}
              />

              <div className="panel-divider" style={{ margin: '16px 0' }} />
              
              <ChartSpecificFields
                mode="mapping"
                chartType={chartType}
                chartQuery={selectedWidget?.chartQuery || {}}
                selectedWidget={selectedWidget}
                selectedTableColumns={selectedTableColumns}
                isLoading={schemaLoading}
                onUpdateChartQuery={updateChartQuery}
                chartOptions={chartOptions}
                onUpdateChartOption={updateChartOption}
                onUpdateChartOptions={updateChartOptions}
              />

              <div className="panel-divider" style={{ margin: '16px 0' }} />

              <ChartSpecificFields
                mode="colors"
                chartType={chartType}
                chartQuery={selectedWidget?.chartQuery || {}}
                selectedWidget={selectedWidget}
                selectedTableColumns={selectedTableColumns}
                isLoading={schemaLoading}
                onUpdateChartQuery={updateChartQuery}
                chartOptions={chartOptions}
                onUpdateChartOption={updateChartOption}
                onUpdateChartOptions={updateChartOptions}
              />

              <ChartOptions
                chartType={chartType}
                chartOptions={chartOptions}
                chartQuery={selectedWidget?.chartQuery || {}}
                onUpdateChartOption={updateChartOption}
              />
            </>
          )}

          {/* Delete Button for all widgets including text */}
          <Divider style={{ margin: '16px 0' }} />
          <Button
            danger
            block
            onClick={() => removeWidget(selectedWidgetId!)}
            style={{ marginTop: 8 }}
          >
            {t('delete_widget')}
          </Button>
        </div>
      ),
    },
    {
      key: 'customize',
      label: 'Customize',
      children: (
        <div className="tab-pane-content" style={{ padding: 0 }}>
          {!isText && (
            <div style={{ padding: '0 16px' }}>
              <ChartSpecificFields
                mode="customize"
                chartType={chartType}
                chartQuery={selectedWidget?.chartQuery || {}}
                selectedWidget={selectedWidget}
                selectedTableColumns={selectedTableColumns}
                isLoading={schemaLoading}
                onUpdateChartQuery={updateChartQuery}
                chartOptions={chartOptions}
                onUpdateChartOption={updateChartOption}
                onUpdateChartOptions={updateChartOptions}
              />
            </div>
          )}

          <Collapse
            ghost
            expandIconPosition="end"
            expandIcon={({ isActive }) => (
              <RightOutlined rotate={isActive ? 90 : 0} style={{ fontSize: '10px', color: '#8c8c8c' }} />
            )}
            className="styling-collapse"
            items={[
              {
                key: 'background',
                label: <span className="collapse-label">{t('background_and_title')}</span>,
                children: (
                  <div className="collapse-content-inner">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span className="field-label-sm">{t('background_color')}</span>
                      <ColorPicker
                        size="small"
                        value={chartOptions.backgroundColor || '#ffffff'}
                        onChange={(color) => updateChartOption('backgroundColor', color.toHexString())}
                        trigger="click"
                        placement="bottomRight"
                        panelRender={(panel) => (
                          <div style={{ width: 220 }}>
                            <div style={{ padding: '8px 12px' }}>
                              <Button
                                block
                                size="small"
                                onClick={() => updateChartOption('backgroundColor', 'transparent')}
                                style={{ marginBottom: 8 }}
                              >
                                {t('transparent')}
                              </Button>
                              <Button
                                block
                                size="small"
                                onClick={() => updateChartOption('backgroundColor', undefined)}
                                style={{ marginBottom: 8 }}
                              >
                                {t('reset_to_default')}
                              </Button>
                            </div>
                            <Divider style={{ margin: 0 }} />
                            <div className="color-picker-panel-custom">{panel}</div>
                          </div>
                        )}
                      >
                        <div className="color-picker-trigger-select">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div
                              className="color-preview-box"
                              style={{ 
                                backgroundColor: chartOptions.backgroundColor === 'transparent' ? 'transparent' : (chartOptions.backgroundColor || '#ffffff'),
                                border: chartOptions.backgroundColor === 'transparent' ? '1px dashed #d9d9d9' : '1px solid #f0f0f0'
                              }}
                            />
                            <span className="color-hex-text">
                              {chartOptions.backgroundColor === 'transparent' ? t('transparent_upper') : (chartOptions.backgroundColor || '#ffffff').toUpperCase()}
                            </span>
                          </div>
                          <RightOutlined rotate={90} style={{ fontSize: 10, color: '#8c8c8c' }} />
                        </div>
                      </ColorPicker>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span className="field-label-sm">{t('title_style')}</span>
                      <ColorPicker
                        size="small"
                        value={chartOptions.titleColor || '#24292f'}
                        onChange={(color) => updateChartOption('titleColor', color.toHexString())}
                        trigger="click"
                        placement="bottomRight"
                        panelRender={(panel) => (
                          <div style={{ width: 220 }}>
                            <div style={{ padding: '8px 12px' }}>
                              <Button
                                block
                                size="small"
                                onClick={() => {
                                  updateChartOptions({
                                    titleColor: undefined,
                                    titleFontWeight: 'normal',
                                  });
                                }}
                                style={{ marginBottom: 8 }}
                              >
                                {t('reset')}
                              </Button>

                              <div style={{ marginBottom: 8, fontSize: 12, color: '#646a73' }}>{t('text_color')}</div>
                              <div className="color-picker-panel-custom">{panel}</div>

                              <div style={{ marginTop: 10 }}>
                                <div style={{ marginBottom: 8, fontSize: 12, color: '#646a73' }}>{t('text_weight')}</div>
                                <Radio.Group
                                  size="small"
                                  value={chartOptions.titleFontWeight || 'normal'}
                                  onChange={(e) => updateChartOption('titleFontWeight', e.target.value)}
                                >
                                  <Radio value="normal">{t('default')}</Radio>
                                  <Radio value="bold">{t('bold')}</Radio>
                                </Radio.Group>
                              </div>
                            </div>
                          </div>
                        )}
                      >
                        <div className="color-picker-trigger-select">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div
                              className="color-preview-box"
                              style={{ backgroundColor: chartOptions.titleColor || '#24292f' }}
                            />
                            <span className="color-hex-text">
                              {(chartOptions.titleColor || '#24292F').toUpperCase()}
                            </span>
                          </div>
                          <RightOutlined rotate={90} style={{ fontSize: 10, color: '#8c8c8c' }} />
                        </div>
                      </ColorPicker>
                    </div>
                  </div>
                ),
              },
              {
                key: 'block-text',
                label: <span className="collapse-label">{t('block_text_style')}</span>,
                children: (
                  <div className="collapse-content-inner" style={{ gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span className="field-label-sm">{t('font_color')}</span>
                      <ColorPicker
                        size="small"
                        value={chartOptions.axisLabelColor === 'default' ? undefined : chartOptions.axisLabelColor}
                        onChange={(color) => updateChartOption('axisLabelColor', color.toHexString())}
                        trigger="click"
                        placement="bottomRight"
                        panelRender={(panel) => (
                          <div style={{ width: 220 }}>
                            <div style={{ padding: '8px 12px' }}>
                              <Button
                                block
                                size="small"
                                onClick={() => updateChartOption('axisLabelColor', 'default')}
                                style={{ marginBottom: 8 }}
                              >
                                {t('reset')}
                              </Button>
                            </div>
                            <Divider style={{ margin: 0 }} />
                            <div className="color-picker-panel-custom">{panel}</div>
                          </div>
                        )}
                      >
                        <div className="color-picker-trigger-select">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {!chartOptions.axisLabelColor || chartOptions.axisLabelColor === 'default' ? (
                              <span className="color-hex-text">{t('default')}</span>
                            ) : (
                              <>
                                <div
                                  className="color-preview-box"
                                  style={{ backgroundColor: chartOptions.axisLabelColor }}
                                />
                                <span className="color-hex-text">{chartOptions.axisLabelColor.toUpperCase()}</span>
                              </>
                            )}
                          </div>
                          <RightOutlined rotate={90} style={{ fontSize: 10, color: '#8c8c8c' }} />
                        </div>
                      </ColorPicker>
                    </div>

                    <SelectField
                      label={t('font_size')}
                      value={chartOptions.axisLabelFontSize || 11}
                      onChange={(val) => updateChartOption('axisLabelFontSize', val)}
                      options={[10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36].map((s) => ({
                        label: `${s}`,
                        value: s,
                      }))}
                      showSearch={false}
                    />
                  </div>
                ),
              },
              {
                key: 'axis-title',
                label: <span className="collapse-label">{t('axis_title')}</span>,
                children: (
                  <div className="collapse-content-inner" style={{ gap: 12 }}>
                    <TextInputField
                      label={t('x_axis_title')}
                      value={chartOptions.xAxisLabel ?? selectedWidget?.chartData?.xMetrics?.[0]?.name ?? ''}
                      onChange={(val) => updateChartOption('xAxisLabel', val)}
                      placeholder={t('x_axis_title_placeholder')}
                    />

                    <TextInputField
                      label={selectedWidget?.chartQuery?.yMetricsSecondary?.length > 0 ? t('left_y_axis_title') : t('y_axis_title')}
                      value={chartOptions.yAxisLabel ?? selectedWidget?.chartData?.series?.[0]?.name ?? ''}
                      onChange={(val) => updateChartOption('yAxisLabel', val)}
                      placeholder={t('y_axis_title_placeholder')}
                    />

                    {selectedWidget?.chartQuery?.yMetricsSecondary?.length > 0 && (
                      <TextInputField
                        label={t('right_y_axis_title')}
                        value={chartOptions.yAxisSecondaryLabel ?? selectedWidget?.chartData?.secondarySeries?.[0]?.name ?? ''}
                        onChange={(val) => updateChartOption('yAxisSecondaryLabel', val)}
                        placeholder={t('secondary_y_axis_title_placeholder')}
                      />
                    )}
                  </div>
                ),
              },
              {
                key: 'legend',
                label: <span className="collapse-label">{t('legend')}</span>,
                children: (
                  <div className="collapse-content-inner">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <CheckboxField
                        label="Show legend"
                        checked={chartOptions.showLegend !== false}
                        onChange={(val) => updateChartOption('showLegend', val)}
                      />
                      
                      <SelectField
                        label="Legend position"
                        value={chartOptions.legendPosition || 'top'}
                        onChange={(val) => updateChartOption('legendPosition', val)}
                        disabled={chartOptions.showLegend === false}
                        options={[
                          { label: t('position_top'), value: 'top' },
                          { label: t('position_bottom'), value: 'bottom' },
                          { label: t('position_left'), value: 'left' },
                          { label: t('position_right'), value: 'right' },
                          { label: t('hide'), value: 'hide' },
                        ]}
                      />
                    </div>
                  </div>
                ),
              },
              {
                key: 'vertical-axis',
                label: <span className="collapse-label">{t('vertical_axis')}</span>,
                children: (
                  <div className="collapse-content-inner">
                    <CheckboxField
                      label={t('show_labels')}
                      checked={chartOptions.showVAxisLabels !== false}
                      onChange={(val) => updateChartOption('showVAxisLabels', val)}
                    />

                    {chartOptions.showVAxisLabels !== false && (
                      <div className="axis-inner-panel">
                        <SelectField
                          label={t('slant_labels')}
                          value={chartOptions.vAxisLabelSlant || 'none'}
                          onChange={(val) => updateChartOption('vAxisLabelSlant', val)}
                          options={[
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowUpOutlined />
                                  </div>
                                  {t('slant_rotate_up')}
                                </div>
                              ),
                              value: 'up',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined style={{ transform: 'rotate(-45deg)' }} />
                                  </div>
                                  {t('slant_left_diagonal')}
                                </div>
                              ),
                              value: 'left-diagonal',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined />
                                  </div>
                                  {t('slant_horizontal')}
                                </div>
                              ),
                              value: 'none',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined style={{ transform: 'rotate(45deg)' }} />
                                  </div>
                                  {t('slant_right_diagonal')}
                                </div>
                              ),
                              value: 'right-diagonal',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowDownOutlined />
                                  </div>
                                  {t('slant_rotate_down')}
                                </div>
                              ),
                              value: 'down',
                            },
                          ]}
                        />

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <span className="field-label-sm">{t('title_format')}</span>
                          <div className="format-toolbar">
                            <Select
                              size="small"
                              variant="borderless"
                              value={chartOptions.vAxisFontSize || 10}
                              onChange={(val) => updateChartOption('vAxisFontSize', val)}
                              style={{ flex: 1 }}
                              suffixIcon={<RightOutlined rotate={90} style={{ fontSize: 8 }} />}
                              options={[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((s) => ({ label: `${s}`, value: s }))}
                            />
                            <div className="format-toolbar-divider" />
                            <div style={{ flex: 1, display: 'flex' }}>
                              <ColorPicker
                                size="small"
                                value={chartOptions.vAxisColor || '#3c4043'}
                                onChange={(color) => updateChartOption('vAxisColor', color.toHexString())}
                                trigger="click"
                                placement="bottomRight"
                                style={{ flex: 1 }}
                              >
                                <div className="format-toolbar-item">
                                  <FontColorsOutlined style={{ color: chartOptions.vAxisColor || '#3c4043' }} />
                                </div>
                              </ColorPicker>
                            </div>
                            <div className="format-toolbar-divider" />
                            <div
                              className={`format-toolbar-item ${chartOptions.vAxisBold ? 'active' : ''}`}
                              onClick={() => updateChartOption('vAxisBold', !chartOptions.vAxisBold)}
                            >
                              <BoldOutlined style={{ fontSize: 12 }} />
                            </div>
                            <div
                              className={`format-toolbar-item ${chartOptions.vAxisItalic ? 'active' : ''}`}
                              onClick={() => updateChartOption('vAxisItalic', !chartOptions.vAxisItalic)}
                            >
                              <ItalicOutlined style={{ fontSize: 12 }} />
                            </div>
                            <div
                              className={`format-toolbar-item ${chartOptions.vAxisStrikethrough ? 'active' : ''}`}
                              onClick={() => updateChartOption('vAxisStrikethrough', !chartOptions.vAxisStrikethrough)}
                            >
                              <StrikethroughOutlined style={{ fontSize: 12 }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: 8 }}>
                      <CheckboxField
                        label={t('show_axis_line')}
                        checked={chartOptions.showVAxisLine !== false}
                        onChange={(val) => updateChartOption('showVAxisLine', val)}
                      />
                    </div>
                  </div>
                ),
              },
              {
                key: 'horizontal-axis',
                label: <span className="collapse-label">{t('horizontal_axis')}</span>,
                children: (
                  <div className="collapse-content-inner">
                    <CheckboxField
                      label={t('show_labels')}
                      checked={chartOptions.showHAxisLabels !== false}
                      onChange={(val) => updateChartOption('showHAxisLabels', val)}
                    />

                    {chartOptions.showHAxisLabels !== false && (
                      <div className="axis-inner-panel">
                        <SelectField
                          label={t('slant_labels')}
                          value={chartOptions.hAxisLabelSlant || 'none'}
                          onChange={(val) => updateChartOption('hAxisLabelSlant', val)}
                          options={[
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowUpOutlined />
                                  </div>
                                  {t('slant_rotate_up')}
                                </div>
                              ),
                              value: 'up',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined style={{ transform: 'rotate(-45deg)' }} />
                                  </div>
                                  {t('slant_left_diagonal')}
                                </div>
                              ),
                              value: 'left-diagonal',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined />
                                  </div>
                                  {t('slant_horizontal')}
                                </div>
                              ),
                              value: 'none',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowRightOutlined style={{ transform: 'rotate(45deg)' }} />
                                  </div>
                                  {t('slant_right_diagonal')}
                                </div>
                              ),
                              value: 'right-diagonal',
                            },
                            {
                              label: (
                                <div className="slant-option">
                                  <div className="slant-icon">
                                    <ArrowDownOutlined />
                                  </div>
                                  {t('slant_rotate_down')}
                                </div>
                              ),
                              value: 'down',
                            },
                          ]}
                        />

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <span className="field-label-sm">{t('title_format')}</span>
                          <div className="format-toolbar">
                            <Select
                              size="small"
                              variant="borderless"
                              value={chartOptions.hAxisFontSize || 10}
                              onChange={(val) => updateChartOption('hAxisFontSize', val)}
                              style={{ flex: 1 }}
                              suffixIcon={<RightOutlined rotate={90} style={{ fontSize: 8 }} />}
                              options={[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((s) => ({ label: `${s}`, value: s }))}
                            />
                            <div className="format-toolbar-divider" />
                            <div style={{ flex: 1, display: 'flex' }}>
                              <ColorPicker
                                size="small"
                                value={chartOptions.hAxisColor || '#3c4043'}
                                onChange={(color) => updateChartOption('hAxisColor', color.toHexString())}
                                trigger="click"
                                placement="bottomRight"
                                style={{ flex: 1 }}
                              >
                                <div className="format-toolbar-item">
                                  <FontColorsOutlined style={{ color: chartOptions.hAxisColor || '#3c4043' }} />
                                </div>
                              </ColorPicker>
                            </div>
                            <div className="format-toolbar-divider" />
                            <div
                              className={`format-toolbar-item ${chartOptions.hAxisBold ? 'active' : ''}`}
                              onClick={() => updateChartOption('hAxisBold', !chartOptions.hAxisBold)}
                            >
                              <BoldOutlined style={{ fontSize: 12 }} />
                            </div>
                            <div
                              className={`format-toolbar-item ${chartOptions.hAxisItalic ? 'active' : ''}`}
                              onClick={() => updateChartOption('hAxisItalic', !chartOptions.hAxisItalic)}
                            >
                              <ItalicOutlined style={{ fontSize: 12 }} />
                            </div>
                            <div
                              className={`format-toolbar-item ${chartOptions.hAxisStrikethrough ? 'active' : ''}`}
                              onClick={() => updateChartOption('hAxisStrikethrough', !chartOptions.hAxisStrikethrough)}
                            >
                              <StrikethroughOutlined style={{ fontSize: 12 }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: 8 }}>
                      <CheckboxField
                        label={t('show_axis_line')}
                        checked={chartOptions.showHAxisLine !== false}
                        onChange={(val) => updateChartOption('showHAxisLine', val)}
                      />
                    </div>
                  </div>
                ),
              },
            ].filter((item) => {
              if (chartType === 'pie' || chartType === 'donut') {
                return !['axis-title', 'vertical-axis', 'horizontal-axis'].includes(item.key);
              }
              return true;
            })}
          />
        </div>
      ),
    },
    {
      key: 'advanced',
      label: 'Advanced',
      children: (
        <div className="tab-pane-content">
          {!isText && (
            <ChartSpecificFields
              mode="advanced"
              chartType={chartType}
              chartQuery={selectedWidget?.chartQuery || {}}
              selectedWidget={selectedWidget}
              selectedTableColumns={selectedTableColumns}
              isLoading={schemaLoading}
              onUpdateChartQuery={updateChartQuery}
              chartOptions={chartOptions}
              onUpdateChartOption={updateChartOption}
              onUpdateChartOptions={updateChartOptions}
            />
          )}
        </div>
      )
    }
  ].filter(item => !isText || item.key === 'general');

  return (
    <aside className={`properties-panel ${isCollapsed || !showSidebar ? 'collapsed' : ''}`}>
      <div className="panel-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
        <h3>{t('properties')}</h3>
      </div>

      {showSidebar && (
        <div className="panel-tabs-wrapper">
          <Tabs
            defaultActiveKey="general"
            items={items}
            className="properties-tabs"
            animated={{ inkBar: true, tabPane: false }}
          />
        </div>
      )}
    </aside>
  );
};
