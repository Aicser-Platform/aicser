'use client';

import React, { useState } from 'react';
import { Input, Select, Switch, Segmented, Checkbox, Typography, Dropdown, MenuProps, ColorPicker, Button, Space, Radio, Divider, Modal, Tabs, Popover, Tooltip } from 'antd';
import { CloseOutlined, DownOutlined, CheckOutlined, HolderOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { SegmentedOption, METRIC_OPTIONS } from './PropertiesPanelConfig';

const { Text } = Typography;

/* =========================================================
 * COLOR UTILITIES (For Theme Generation)
 * =======================================================*/

const hexToHsl = (hex: string) => {
  let r = 0, g = 0, b = 0;
  let a = 1;
  const hStr = hex.startsWith('#') ? hex.slice(1) : hex;
  if (hStr.length === 3) {
    r = parseInt(hStr[0] + hStr[0], 16);
    g = parseInt(hStr[1] + hStr[1], 16);
    b = parseInt(hStr[2] + hStr[2], 16);
  } else if (hStr.length === 4) {
    r = parseInt(hStr[0] + hStr[0], 16);
    g = parseInt(hStr[1] + hStr[1], 16);
    b = parseInt(hStr[2] + hStr[2], 16);
    a = parseInt(hStr[3] + hStr[3], 16) / 255;
  } else if (hStr.length === 6) {
    r = parseInt(hStr.slice(0, 2), 16);
    g = parseInt(hStr.slice(2, 4), 16);
    b = parseInt(hStr.slice(4, 6), 16);
  } else if (hStr.length === 8) {
    r = parseInt(hStr.slice(0, 2), 16);
    g = parseInt(hStr.slice(2, 4), 16);
    b = parseInt(hStr.slice(4, 6), 16);
    a = parseInt(hStr.slice(6, 8), 16) / 255;
  }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100, a };
};

const hslToHex = (h: number, s: number, l: number, a: number = 1) => {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = (x: number) => {
    const hexVal = Math.round(x * 255).toString(16).padStart(2, '0');
    return hexVal;
  };
  const alphaHex = a < 1 ? toHex(a) : '';
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${alphaHex}`;
};

const generateShades = (hex: string) => {
  const { h, s, l, a } = hexToHsl(hex);
  // [Lighter -> Base -> Darker]
  const variations = [25, 12, 0, -12, -25];
  return variations.map(v => hslToHex(h, s, Math.min(95, Math.max(5, l + v)), a));
};

/* =========================================================
 * Field: Section Label
 * Displays field label with optional required indicator
 * =======================================================*/

interface FieldProps {
  label: string;
  required?: boolean;
  className?: string;
  hint?: string;
}

export const SectionLabel: React.FC<FieldProps> = ({ label, required = false, className = '', hint }) => (
  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }} className={className}>
    <Text className="section-label">
      {label}
      {required && <span className="required-star">*</span>}
    </Text>
    {hint ? (
      <Tooltip title={hint}>
        <InfoCircleOutlined
          style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)', cursor: 'help' }}
          aria-label={hint}
        />
      </Tooltip>
    ) : null}
  </div>
);

/* =========================================================
 * Field: Select
 * Dropdown select with search, loading, and popup styling
 * =======================================================*/

interface SelectFieldProps extends FieldProps {
  value: any;
  onChange: (value: any) => void;
  options: { label: React.ReactNode; value: any }[];
  placeholder?: string;
  disabled?: boolean;
  isLoading?: boolean;
  showSearch?: boolean;
  allowClear?: boolean;
  mode?: 'multiple' | 'tags';
}

export const SelectField: React.FC<SelectFieldProps> = ({
  label,
  required,
  hint,
  value,
  onChange,
  options,
  placeholder = 'Select an option...',
  disabled = false,
  isLoading = false,
  showSearch = true,
  allowClear,
  mode,
}) => (
  <div className="panel-section">
    <SectionLabel label={label} required={required} hint={hint} />
    <Select
      style={{ width: '100%' }}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      loading={isLoading}
      size="small"
      showSearch={showSearch}
      optionFilterProp="label"
      mode={mode}
      allowClear={allowClear ?? !required}
      styles={{
        popup: { root: { zIndex: 10000, maxHeight: 300 } },
      }}
      getPopupContainer={() => document.body}
    />
  </div>
);

/* =========================================================
 * Field: Input
 * Standard text or number input field with label
 * =======================================================*/

interface InputFieldProps extends FieldProps {
  value: any;
  onChange: (value: any) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}

export const InputField: React.FC<InputFieldProps> = ({
  label,
  required,
  hint,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
}) => (
  <div className="panel-section">
    <SectionLabel label={label} required={required} hint={hint} />
    <Input
      size="small"
      className="premium-input"
      type={type}
      value={value === 0 ? 0 : (value || '')}
      onChange={(e) => {
        const val = e.target.value;
        onChange(type === 'number' ? (val === '' ? undefined : Number(val)) : val);
      }}
      placeholder={placeholder}
      disabled={disabled}
    />
  </div>
);

/* =========================================================
 * Field: Metric List
 * Power BI like multi-metric selection with aggregation
 * =======================================================*/

export interface MetricItem {
  field: string;
  aggregation: string;
}

interface MetricListFieldProps extends FieldProps {
  metrics: MetricItem[];
  onChange: (metrics: MetricItem[]) => void;
  columnOptions: { label: React.ReactNode; value: string; type?: string }[];
  isLoading?: boolean;
  placeholder?: string;
  maxItems?: number;
  excludeFields?: string[];
  chartType?: string;
}

export const MetricListField: React.FC<MetricListFieldProps> = ({
  label,
  required,
  hint,
  metrics = [],
  onChange,
  columnOptions,
  isLoading = false,
  placeholder = 'Add data fields here',
  maxItems,
  excludeFields = [],
  chartType,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const isLimitReached = maxItems !== undefined && metrics.length >= maxItems;

  const handleAddField = (fieldValue: string) => {
    if (!fieldValue) return;

    const defaultAgg = chartType === 'scatter' ? 'none' : 'count';

    const newMetric: MetricItem = {
      field: fieldValue,
      aggregation: defaultAgg,
    };

    if (maxItems === 1) {
      // For single metrics, just replace the existing one
      onChange([newMetric]);
    } else {
      if (isLimitReached) return;
      onChange([...metrics, newMetric]);
    }
  };

  const handleUpdateAggregation = (index: number, agg: string) => {
    const updated = [...metrics];
    updated[index] = { ...updated[index], aggregation: agg };
    onChange(updated);
  };

  const handleRemoveField = (index: number) => {
    const updated = metrics.filter((_, i) => i !== index);
    onChange(updated);
  };

  const getAggregationLabel = (val: string) => {
    return METRIC_OPTIONS.find((opt) => opt.value === val)?.label || val;
  };

  // Helper to find column label from value
  const getFieldLabel = (fieldValue: string) => {
    return columnOptions.find((opt) => opt.value === fieldValue)?.label || fieldValue;
  };

  // Filter out columns that are already in the metrics list (only for multi-select)
  // PLUS filter out columns that are in the excludeFields list
  const availableOptions =
    maxItems === 1
      ? columnOptions.filter((opt) => !excludeFields.includes(opt.value))
      : columnOptions.filter(
          (opt) => !metrics.some((m) => m.field === opt.value) && !excludeFields.includes(opt.value)
        );

  /* =========================================================
   * Drag and Drop Handlers
   * =======================================================*/

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (maxItems === 1) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    const target = e.target as HTMLElement;
    target.style.opacity = '0.4';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedIndex(null);
    const target = e.target as HTMLElement;
    target.style.opacity = '1';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) return;

    const updatedMetrics = [...metrics];
    const itemToMove = updatedMetrics.splice(draggedIndex, 1)[0];
    updatedMetrics.splice(dropIndex, 0, itemToMove);

    onChange(updatedMetrics);
    setDraggedIndex(null);
  };

  return (
    <div className="panel-section">
      <SectionLabel label={label} required={required} hint={hint} />

      <div className="metric-list-container" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {metrics.map((item, index) => {
          const fieldInfo = columnOptions.find((opt) => opt.value === item.field);
          const type = (fieldInfo?.type || '').toLowerCase();
          const isNumeric =
            type.includes('int') ||
            type.includes('float') ||
            type.includes('number') ||
            type.includes('decimal') ||
            type.includes('double') ||
            type.includes('real') ||
            type.includes('numeric');

          const allowedAggregations = isNumeric
            ? METRIC_OPTIONS.filter((opt) => chartType === 'scatter' || opt.value !== 'none')
            : METRIC_OPTIONS.filter((opt) => {
              if (opt.value === 'none') return chartType === 'scatter';
              const valString = String(opt.value);
              return ['count', 'distinct_count'].includes(valString);
            });

          const menuItems: MenuProps['items'] = [
            {
              key: 'remove',
              label: 'Remove field',
              danger: true,
              onClick: () => handleRemoveField(index),
            },
            { type: 'divider' },
            ...allowedAggregations.map((opt) => ({
              key: opt.value as string,
              label: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {opt.label}
                  {item.aggregation === opt.value && <CheckOutlined style={{ fontSize: '12px' }} />}
                </div>
              ),
              onClick: () => handleUpdateAggregation(index, opt.value as string),
            })),
          ];

          return (
            <div
              key={`${item.field}-${index}`}
              draggable={maxItems !== 1}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              className={`metric-item-draggable ${draggedIndex === index ? 'dragging' : ''} ${maxItems === 1 ? 'no-drag' : ''}`}
            >
              <Dropdown menu={{ items: menuItems }} trigger={['click']}>
                <div className="metric-item-ui">
                  <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', gap: 8 }}>
                    {maxItems !== 1 && <HolderOutlined style={{ color: '#bfbfbf', cursor: 'grab' }} />}
                    <Text
                      style={{ fontSize: '11px' }}
                      className="metric-item-label"
                      ellipsis
                      title={item.aggregation === 'none' ? String(getFieldLabel(item.field)) : `${getAggregationLabel(item.aggregation)} of ${String(getFieldLabel(item.field))}`}
                    >
                      {item.aggregation === 'none' ? getFieldLabel(item.field) : `${getAggregationLabel(item.aggregation)} of ${String(getFieldLabel(item.field))}`}
                    </Text>
                  </div>
                  <div className="metric-item-actions">
                    <DownOutlined style={{ fontSize: 8 }} />
                    <CloseOutlined
                      style={{ fontSize: 10 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveField(index);
                      }}
                    />
                  </div>
                </div>
              </Dropdown>
            </div>
          );
        })}

        {!isLimitReached && (
          <Select
            style={{ width: '100%', marginTop: metrics.length > 0 ? 4 : 0 }}
            placeholder={placeholder}
            loading={isLoading}
            onChange={handleAddField}
            value={null}
            options={availableOptions}
            showSearch
            optionFilterProp="label"
            size="small"
            dropdownStyle={{ zIndex: 10000 }}
            getPopupContainer={() => document.body}
          />
        )}
      </div>
    </div>
  );
};

/* =========================================================
 * Field: Filter List
 * Power BI like filtering system
 * =======================================================*/

export interface FilterItem {
  field: string;
  operator: string;
  value: any;
  type: 'simple' | 'sql';
  sql?: string;
}

const FILTER_OPERATORS = [
  { label: 'Is null', value: 'is_null', disableValue: true },
  { label: 'Is not null', value: 'is_not_null', disableValue: true },
  { label: 'Equal (=)', value: '=' },
  { label: 'Not equal (≠)', value: '!=' },
  { label: 'Greater than (>)', value: '>' },
  { label: 'Greater or equal (≥)', value: '>=' },
  { label: 'Less than (<)', value: '<' },
  { label: 'Less or equal (≤)', value: '<=' },
  { label: 'In', value: 'in' },
  { label: 'Not In', value: 'not_in' },
  { label: 'Like', value: 'like' },
  { label: 'Like (case sensitive)', value: 'like_case' },
];

interface FilterListFieldProps extends FieldProps {
  filters: FilterItem[];
  onChange: (filters: FilterItem[]) => void;
  columnOptions: { label: React.ReactNode; value: string; type?: string }[];
  isLoading?: boolean;
  placeholder?: string;
}

export const FilterListField: React.FC<FilterListFieldProps> = ({
  label,
  required,
  hint,
  filters = [],
  onChange,
  columnOptions,
  placeholder = 'Select columns here or click',
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [tempFilter, setTempFilter] = useState<FilterItem>({
    field: '',
    operator: '=',
    value: '',
    type: 'simple',
  });

  const handleAddFilterClick = () => {
    setEditingIndex(null);
    setTempFilter({
      field: columnOptions[0]?.value || '',
      operator: '=',
      value: '',
      type: 'simple',
    });
    setIsModalOpen(true);
  };

  const handleEditFilter = (index: number) => {
    setEditingIndex(index);
    setTempFilter({ ...filters[index] });
    setIsModalOpen(true);
  };

  const handleRemoveFilter = (index: number) => {
    const updated = filters.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleSaveFilter = () => {
    if (editingIndex !== null) {
      const updated = [...filters];
      updated[editingIndex] = tempFilter;
      onChange(updated);
    } else {
      onChange([...filters, tempFilter]);
    }
    setIsModalOpen(false);
  };

  const filterOp = FILTER_OPERATORS.find(op => op.value === tempFilter.operator);

  const filterConfigContent = (
    <div style={{ width: 280, padding: '4px 8px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 12 }}>
        <div>
          <div style={{ marginBottom: 4, fontSize: '11px', color: 'var(--studio-text-secondary)' }}>Column</div>
          <Select
            style={{ width: '100%' }}
            size="small"
            options={columnOptions.map(opt => {
              const isNumeric = (opt.type || '').toLowerCase().includes('int') || 
                              (opt.type || '').toLowerCase().includes('float') || 
                              (opt.type || '').toLowerCase().includes('number') || 
                              (opt.type || '').toLowerCase().includes('decimal');
              return {
                label: (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--studio-primary)', fontSize: 13, minWidth: 14 }}>
                      {isNumeric ? '#' : 'abc'}
                    </span>
                    {opt.label}
                  </div>
                ),
                value: opt.value,
              };
            })}
            value={tempFilter.field}
            onChange={(val) => setTempFilter({ ...tempFilter, field: val })}
            showSearch
            placeholder="Select column"
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, fontSize: '11px', color: 'var(--studio-text-secondary)' }}>Operator</div>
          <Select
            style={{ width: '100%' }}
            size="small"
            options={FILTER_OPERATORS}
            value={tempFilter.operator}
            onChange={(val) => {
              let newValue = tempFilter.value;
              const wasIn = ['in', 'not_in'].includes(tempFilter.operator);
              const isIn = ['in', 'not_in'].includes(val);
              
              if (isIn && !wasIn) {
                newValue = tempFilter.value ? [String(tempFilter.value)] : [];
              } else if (!isIn && wasIn) {
                newValue = Array.isArray(tempFilter.value) ? tempFilter.value.join(', ') : String(tempFilter.value);
              }
              
              setTempFilter({ ...tempFilter, operator: val, value: newValue });
            }}
            placeholder="Select operator"
            showSearch
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, fontSize: '11px', color: 'var(--studio-text-secondary)' }}>Value</div>
          {['in', 'not_in'].includes(tempFilter.operator) ? (
            <Select
              mode="tags"
              className="filter-select"
              style={{ width: '100%' }}
              placeholder="Type and press enter..."
              value={Array.isArray(tempFilter.value) ? tempFilter.value : (tempFilter.value ? String(tempFilter.value).split(',').map(s => s.trim()) : [])}
              onChange={(vals) => setTempFilter({ ...tempFilter, value: vals })}
              tokenSeparators={[',']}
              dropdownStyle={{ display: 'none' }}
              allowClear
              suffixIcon={<CloseOutlined style={{ rotate: '45deg', color: 'var(--studio-text-muted)' }} />}
            />
          ) : (
            <Input
              size="small"
              className="premium-input"
              placeholder={filterOp?.disableValue ? "(Value not required)" : "Filter value"}
              value={filterOp?.disableValue ? "" : tempFilter.value}
              onChange={(e) => setTempFilter({ ...tempFilter, value: e.target.value })}
              disabled={filterOp?.disableValue}
            />
          )}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, borderTop: '1px solid var(--studio-border)', paddingTop: 12 }}>
        <Button size="small" onClick={() => setIsModalOpen(false)} style={{ borderRadius: 6 }}>Close</Button>
        <Button size="small" type="primary" onClick={handleSaveFilter} style={{ borderRadius: 6, background: 'var(--studio-primary)' }}>Save</Button>
      </div>
    </div>
  );

  return (
    <div className="panel-section">
      <SectionLabel label={label} required={required} hint={hint} />

      <div className="metric-list-container" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filters.map((filter, index) => (
          <Popover
            key={index}
            content={filterConfigContent}
            title={<div style={{ padding: '8px 0', borderBottom: '1px solid var(--studio-border)', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>Edit Filter</div>}
            trigger="click"
            open={isModalOpen && editingIndex === index}
            onOpenChange={(open) => {
              if (open) handleEditFilter(index);
              else setIsModalOpen(false);
            }}
            placement="leftTop"
            overlayClassName="filter-popover"
          >
            <div className="metric-item-ui" style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', gap: 8, flex: 1 }}>
                <div className="filter-item-details">
                  <span className="filter-item-field">
                    {columnOptions.find(opt => opt.value === filter.field)?.label || filter.field}
                  </span>
                <span className="filter-item-condition">
                  {filter.type === 'sql' 
                    ? 'Custom SQL' 
                    : `${FILTER_OPERATORS.find(op => op.value === filter.operator)?.label || filter.operator}${
                        FILTER_OPERATORS.find(op => op.value === filter.operator)?.disableValue 
                          ? '' 
                          : ` ${Array.isArray(filter.value) ? filter.value.join(', ') : String(filter.value)}`
                      }`}
                </span>
                </div>
              </div>
              <div className="metric-item-actions">
                <CloseOutlined
                  style={{ fontSize: 10 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveFilter(index);
                  }}
                />
              </div>
            </div>
          </Popover>
        ))}

        <Popover
          content={filterConfigContent}
          title="Add Filter"
          trigger="click"
          open={isModalOpen && editingIndex === null}
          onOpenChange={(open) => {
            if (open) handleAddFilterClick();
            else setIsModalOpen(false);
          }}
          placement="leftTop"
          overlayClassName="filter-popover"
        >
          <Button
            type="dashed"
            block
            size="small"
            icon={<CloseOutlined style={{ transform: 'rotate(45deg)' }} />}
            style={{ 
              fontSize: '12px', 
              height: '32px', 
              borderRadius: '6px',
              color: 'var(--studio-text-secondary)',
              borderColor: 'rgba(0,0,0,0.1)',
              background: 'transparent'
            }}
          >
            {placeholder}
          </Button>
        </Popover>
      </div>
    </div>
  );
};

/* =========================================================
 * Field: Metric Filter List
 * Filter aggregated metrics (HAVING clause)
 * =======================================================*/

interface MetricFilterListFieldProps extends FieldProps {
  filters: any[];
  onChange: (filters: any[]) => void;
  metricOptions: { label: string; value: string; field: string; aggregation: string }[];
  isLoading?: boolean;
  placeholder?: string;
}

export const MetricFilterListField: React.FC<MetricFilterListFieldProps> = ({
  label,
  required,
  hint,
  filters = [],
  onChange,
  metricOptions = [],
  isLoading = false,
  placeholder = 'Add filters here',
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [tempFilter, setTempFilter] = useState<any>({
    field: '',
    aggregation: 'sum',
    operator: '=',
    value: '',
  });

  const handleAddFilterClick = () => {
    setEditingIndex(null);
    const firstMetric = metricOptions[0];
    setTempFilter({
      field: firstMetric?.field || '',
      aggregation: firstMetric?.aggregation || 'sum',
      operator: '>',
      value: '',
    });
    setIsModalOpen(true);
  };

  const handleEditFilter = (index: number) => {
    setEditingIndex(index);
    setTempFilter({ ...filters[index] });
    setIsModalOpen(true);
  };

  const handleRemoveFilter = (index: number) => {
    const updated = filters.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleSaveFilter = () => {
    if (editingIndex !== null) {
      const updated = [...filters];
      updated[editingIndex] = tempFilter;
      onChange(updated);
    } else {
      onChange([...filters, tempFilter]);
    }
    setIsModalOpen(false);
  };

  const filterConfigContent = (
    <div style={{ width: 280, padding: '4px 8px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 12 }}>
        <div>
          <div style={{ marginBottom: 4, fontSize: '11px', color: 'var(--studio-text-secondary)' }}>Metric</div>
          <Select
            style={{ width: '100%' }}
            size="small"
            options={metricOptions.map(opt => ({
              label: opt.label,
              value: `${opt.field}|${opt.aggregation}`
            }))}
            value={`${tempFilter.field}|${tempFilter.aggregation}`}
            onChange={(val) => {
              const [field, aggregation] = val.split('|');
              setTempFilter({ ...tempFilter, field, aggregation });
            }}
            placeholder="Select metric"
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, fontSize: '11px', color: 'var(--studio-text-secondary)' }}>Operator</div>
          <Select
            style={{ width: '100%' }}
            size="small"
            options={[
              { label: 'Equal (=)', value: '=' },
              { label: 'Not equal (≠)', value: '!=' },
              { label: 'Greater than (>)', value: '>' },
              { label: 'Greater or equal (≥)', value: '>=' },
              { label: 'Less than (<)', value: '<' },
              { label: 'Less or equal (≤)', value: '<=' },
            ]}
            value={tempFilter.operator}
            onChange={(val) => setTempFilter({ ...tempFilter, operator: val })}
            placeholder="Select operator"
          />
        </div>
        <div>
          <div style={{ marginBottom: 4, fontSize: '11px', color: 'var(--studio-text-secondary)' }}>Value</div>
          <Input
            size="small"
            className="premium-input"
            type="number"
            placeholder="Metric value"
            value={tempFilter.value}
            onChange={(e) => setTempFilter({ ...tempFilter, value: e.target.value })}
          />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, borderTop: '1px solid var(--studio-border)', paddingTop: 12 }}>
        <Button size="small" onClick={() => setIsModalOpen(false)} style={{ borderRadius: 6 }}>Close</Button>
        <Button size="small" type="primary" onClick={handleSaveFilter} style={{ borderRadius: 6, background: 'var(--studio-primary)' }}>Save</Button>
      </div>
    </div>
  );

  return (
    <div className="panel-section">
      <SectionLabel label={label} required={required} hint={hint} />

      <div className="metric-list-container" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filters.map((filter, index) => {
          const metricLabel = metricOptions.find(opt => opt.field === filter.field && opt.aggregation === filter.aggregation)?.label || 
                            `${filter.aggregation} of ${filter.field}`;
          return (
            <Popover
              key={index}
              content={filterConfigContent}
              title={<div style={{ padding: '8px 0', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>Edit Metric Filter</div>}
              trigger="click"
              open={isModalOpen && editingIndex === index}
              onOpenChange={(open) => {
                if (open) handleEditFilter(index);
                else setIsModalOpen(false);
              }}
              placement="leftTop"
              overlayClassName="filter-popover"
            >
              <div className="metric-item-ui" style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', gap: 8, flex: 1 }}>
                  <div className="filter-item-details">
                    <span className="filter-item-field">{metricLabel}</span>
                    <span className="filter-item-condition">
                      {filter.operator} {filter.value}
                    </span>
                  </div>
                </div>
                <div className="metric-item-actions">
                  <CloseOutlined
                    style={{ fontSize: 10 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveFilter(index);
                    }}
                  />
                </div>
              </div>
            </Popover>
          );
        })}

        <Popover
          content={filterConfigContent}
          title="Add Metric Filter"
          trigger="click"
          open={isModalOpen && editingIndex === null}
          onOpenChange={(open) => {
            if (open) handleAddFilterClick();
            else setIsModalOpen(false);
          }}
          placement="leftTop"
          overlayClassName="filter-popover"
        >
          <Button
            type="dashed"
            block
            size="small"
            icon={<CloseOutlined style={{ transform: 'rotate(45deg)' }} />}
            style={{ 
              fontSize: '12px', 
              height: '32px', 
              borderRadius: '6px',
              color: 'var(--studio-text-secondary)',
              borderColor: 'rgba(0,0,0,0.1)',
              background: 'transparent'
            }}
          >
            {placeholder}
          </Button>
        </Popover>
      </div>
    </div>
  );
};

/* =========================================================
 * Field: Toggle
 * Boolean switch control
 * =======================================================*/

interface ToggleFieldProps extends FieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const ToggleField: React.FC<ToggleFieldProps> = ({ label, checked, onChange, disabled = false }) => (
  <div className="toggle-wrapper" style={{ marginBottom: 16 }}>
    <span style={{ fontSize: '13px', color: '#1f2329' }}>{label}</span>
    <Switch checked={checked} onChange={onChange} disabled={disabled} size="small" />
  </div>
);

/* =========================================================
 * Field: Segmented
 * Segmented control for enum-like selections
 * =======================================================*/

interface SegmentedFieldProps extends FieldProps {
  value: any;
  onChange: (value: any) => void;
  options: SegmentedOption[];
  disabled?: boolean;
  block?: boolean;
}

export const SegmentedField: React.FC<SegmentedFieldProps> = ({
  label,
  value,
  onChange,
  options,
  disabled = false,
  block = true,
}) => (
  <div className="panel-section">
    <SectionLabel label={label} />
    <Segmented block={block} options={options} value={value} onChange={onChange} disabled={disabled} size='small' />
  </div>
);

/* =========================================================
 * Field: Checkbox
 * Single checkbox field
 * =======================================================*/

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

export const CheckboxField: React.FC<CheckboxFieldProps> = ({ label, checked, onChange, className = '' }) => (
  <Checkbox className={`checkbox-item ${className}`} checked={checked} onChange={(e) => onChange(e.target.checked)}>
    {label}
  </Checkbox>
);

/* =========================================================
 * Field: Text Input
 * Basic text input field
 * =======================================================*/

interface TextInputFieldProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const TextInputField: React.FC<TextInputFieldProps> = ({
  label,
  required,
  value,
  onChange,
  placeholder = '',
}) => (
  <div className="panel-section">
    <SectionLabel label={label} required={required} />
    <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} size="small" />
  </div>
);

/* =========================================================
 * Field: Text Area
 * Multiline text input field
 * =======================================================*/

interface TextAreaFieldProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

export const TextAreaField: React.FC<TextAreaFieldProps> = ({
  label,
  required,
  value,
  onChange,
  placeholder = '',
  rows = 4,
}) => (
  <div className="panel-section">
    <SectionLabel label={label} required={required} />
    <Input.TextArea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      size="small"
      rows={rows}
    />
  </div>
);

/* =========================================================
 * Field: Color Palette
 * Theme color palette selection for charts
 * =======================================================*/

import {
  CHART_PALETTE_CATALOG,
  WIDGET_PALETTE_INHERIT,
  isWidgetPaletteInherited,
} from '../utils/chartPaletteCatalog';

interface ColorPaletteFieldProps extends FieldProps {
  value: string;
  chartOptions?: any;
  dashboardDefaultPalette?: string;
  onChange: (value: string) => void;
  onUpdateChartOptions?: (updates: Record<string, any>) => void;
}

export const ColorPaletteField: React.FC<ColorPaletteFieldProps> = ({
  label,
  value,
  chartOptions,
  dashboardDefaultPalette,
  onChange,
  onUpdateChartOptions,
}) => {
  const t = useTranslations('dashboards');
  const inheritPaletteId =
    dashboardDefaultPalette && CHART_PALETTE_CATALOG.some((p) => p.id === dashboardDefaultPalette)
      ? dashboardDefaultPalette
      : 'default';
  const inheritPalette = CHART_PALETTE_CATALOG.find((p) => p.id === inheritPaletteId);

  const renderSwatches = (colors: readonly string[]) =>
    colors.length > 0 ? (
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        {colors.map((color: string, idx: number) => (
          <div
            key={idx}
            style={{
              width: 12,
              height: 12,
              backgroundColor: color,
              borderRadius: 2,
              border: '1px solid #e0e0e0',
            }}
          />
        ))}
      </div>
    ) : null;

  // Label + swatches share one row; the label truncates with an ellipsis so it
  // never overflows the narrow (300px) properties panel and overlaps the swatches.
  const paletteRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 };
  const paletteLabelStyle: React.CSSProperties = {
    fontSize: '12px',
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const renderPalette = (palette: { labelKey?: string; label?: string; colors: readonly string[] }) => (
    <div style={paletteRowStyle}>
      <span style={paletteLabelStyle}>
        {palette.labelKey ? t(palette.labelKey as 'palette_default') : palette.label}
      </span>
      {renderSwatches(palette.colors)}
    </div>
  );

  const paletteOptions = [
    {
      // Inherit option: a single "Inherit dashboard brand" label + the brand
      // swatches. The nested palette name was redundant and caused the overlap.
      label: (
        <div style={paletteRowStyle}>
          <span style={paletteLabelStyle}>{t('palette_inherit_dashboard')}</span>
          {inheritPalette ? renderSwatches(inheritPalette.colors) : null}
        </div>
      ),
      value: WIDGET_PALETTE_INHERIT,
    },
    ...CHART_PALETTE_CATALOG.map((palette) => ({
      label: renderPalette(palette),
      value: palette.id,
    })),
    { label: t('palette_custom'), value: 'custom' },
  ];

  const selectValue = isWidgetPaletteInherited(value) ? WIDGET_PALETTE_INHERIT : value;

  return (
    <div className="panel-section">
      <SectionLabel label={label} />
      <Select
        style={{ width: '100%' }}
        value={selectValue}
        onChange={(val) => {
          if (onUpdateChartOptions) {
            if (val === 'custom') {
              onUpdateChartOptions({
                colorPalette: 'custom',
                customColor: chartOptions?.customColor || '#00c2cb',
                customPalette: chartOptions?.customPalette || generateShades(chartOptions?.customColor || '#00c2cb'),
              });
            } else if (val === WIDGET_PALETTE_INHERIT) {
              onUpdateChartOptions({
                colorPalette: WIDGET_PALETTE_INHERIT,
                customColor: undefined,
                customPalette: undefined,
                paletteInverted: false,
              });
            } else {
              onUpdateChartOptions({
                colorPalette: val,
                customColor: undefined,
                customPalette: undefined,
                paletteInverted: false,
              });
            }
          } else {
            onChange(val === WIDGET_PALETTE_INHERIT ? WIDGET_PALETTE_INHERIT : val);
          }
        }}
        size="small"
        placeholder={t('palette_select_placeholder')}
        options={paletteOptions}
        optionRender={(option) => option.label}
      />
    </div>
  );
};

/* =========================================================
 * Field: Color Picker (Theme Generator)
 * Custom color selection with shaded palette generation
 * =======================================================*/

interface ColorPickerFieldProps extends FieldProps {
  value: string;
  inverted?: boolean;
  onChange: (color: string, palette: string[], inverted: boolean) => void;
}

export const ColorPickerField: React.FC<ColorPickerFieldProps> = ({ 
  label, 
  value, 
  inverted = false, 
  onChange 
}) => {
  const shades = generateShades(value);
  const palettes = {
    normal: shades,
    reversed: [...shades].reverse()
  };

  const handleBaseColorChange = (color: string) => {
    const newShades = generateShades(color);
    const activePalette = inverted ? [...newShades].reverse() : newShades;
    onChange(color, activePalette, inverted);
  };

  const handleInversionChange = (isInverted: boolean) => {
    const activePalette = isInverted ? [...palettes.normal].reverse() : palettes.normal;
    onChange(value, activePalette, isInverted);
  };

  const renderPaletteRow = (paletteColors: string[], isActive: boolean, type: boolean) => (
    <div 
      style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 12, 
        padding: '8px 10px',
        borderRadius: '8px',
        cursor: 'pointer',
        background: isActive ? 'var(--studio-primary-light)' : 'transparent',
        border: `1px solid ${isActive ? 'var(--studio-primary)' : 'rgba(0,0,0,0.05)'}`,
        transition: 'all 0.2s ease',
        margin: '2px 0'
      }}
      onClick={() => handleInversionChange(type)}
    >
      <span style={{ fontSize: '11px', color: 'var(--studio-text-secondary)', width: 30, fontWeight: 500 }}>Less</span>
      <div style={{ display: 'flex', gap: 3, flex: 1 }}>
        {paletteColors.map((c, i) => (
          <div key={i} style={{ flex: 1, height: 18, borderRadius: 3, backgroundColor: c, border: '1px solid rgba(0,0,0,0.05)' }} />
        ))}
      </div>
      <span style={{ fontSize: '11px', color: 'var(--studio-text-secondary)', width: 30, fontWeight: 500 }}>More</span>
      <Radio checked={isActive} />
    </div>
  );

  return (
    <div className="panel-section">
      <SectionLabel label={label} />
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 4 }}>
        <ColorPicker
          value={value}
          onChange={(color) => handleBaseColorChange(color.toHexString())}
          size="small"
          showText
          panelRender={(panel) => (
            <div className="custom-picker-dropdown" style={{ width: 260 }}>
              <div style={{ padding: 12 }}>{panel}</div>
              <Divider style={{ margin: 0 }} />
              <div style={{ padding: 16 }}>
                <div style={{ marginBottom: 12, fontSize: '12px', fontWeight: 600, color: 'var(--studio-text-main)' }}>Palette Generation</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {renderPaletteRow(palettes.normal, !inverted, false)}
                  {renderPaletteRow(palettes.reversed, inverted, true)}
                </div>
              </div>
            </div>
          )}
        />
        <Button 
          type="link" 
          size="small" 
          style={{ padding: 0, fontSize: '11px', color: 'var(--studio-text-secondary)' }}
          onClick={() => handleBaseColorChange('#00c2cb')}
        >
          Reset
        </Button>
      </Space>
    </div>
  );
};
