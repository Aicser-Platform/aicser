'use client';

import React, { useEffect, useState } from 'react';
import { Modal, Select, Radio, Input, Space, Divider, Typography } from 'antd';
import type { ComputedMetricSide, ComputedMetric, MetricValueFormat } from './PropertiesPanelConfig';
import type { MetricItem } from './FormFields';

const { Text } = Typography;

const AGG_OPTIONS: { label: string; value: ComputedMetricSide['aggregation'] }[] = [
  { label: 'Sum', value: 'sum' },
  { label: 'Count', value: 'count' },
  { label: 'Count Distinct', value: 'distinct_count' },
  { label: 'Average', value: 'avg' },
  { label: 'Min', value: 'min' },
  { label: 'Max', value: 'max' },
];

const FORMAT_OPTIONS: { label: string; value: MetricValueFormat }[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'Percent (%)', value: 'percent' },
  { label: 'Compact (1.2K)', value: 'compact' },
  { label: 'Currency ($)', value: 'currency' },
  { label: 'Full number', value: 'full' },
];

interface Props {
  open: boolean;
  initial?: MetricItem;
  columnOptions: { label: React.ReactNode; value: string; type?: string }[];
  onSave: (metric: MetricItem) => void;
  onCancel: () => void;
}

interface SideEditorProps {
  title: string;
  value: ComputedMetricSide;
  onChange: (v: ComputedMetricSide) => void;
  stringOptions: { label: string; value: string }[];
}

const defaultSide = (): ComputedMetricSide => ({ field: '', aggregation: 'sum' });

const SideEditor: React.FC<SideEditorProps> = ({ title, value, onChange, stringOptions }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <Text style={{ fontSize: 11, fontWeight: 600 }}>{title}</Text>
    <div style={{ display: 'flex', gap: 6 }}>
      <Select
        size="small"
        style={{ flex: 1 }}
        placeholder="Field"
        value={value.field || undefined}
        onChange={(v: string) => onChange({ ...value, field: v })}
        options={stringOptions}
        showSearch
        filterOption={(input, option) =>
          String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
        }
      />
      <Select
        size="small"
        style={{ width: 110 }}
        value={value.aggregation}
        onChange={(v: ComputedMetricSide['aggregation']) => onChange({ ...value, aggregation: v })}
        options={AGG_OPTIONS}
      />
    </div>
  </div>
);

export function ComputedMetricEditor({ open, initial, columnOptions, onSave, onCancel }: Props) {
  const existingComputed = initial?.computed;
  const [label, setLabel] = useState(initial?.label ?? initial?.field ?? '');
  const [numerator, setNumerator] = useState<ComputedMetricSide>(
    existingComputed?.numerator ?? defaultSide()
  );
  const [denominator, setDenominator] = useState<ComputedMetricSide>(
    existingComputed?.denominator ?? defaultSide()
  );
  const [multiplier, setMultiplier] = useState<1 | 100>(existingComputed?.multiplier ?? 1);
  const [valueFormat, setValueFormat] = useState<MetricValueFormat>(
    initial?.valueFormat || existingComputed?.format || (existingComputed?.multiplier === 100 ? 'percent' : 'auto')
  );

  useEffect(() => {
    if (!open) return;
    const nextComputed = initial?.computed;
    setLabel(initial?.label ?? initial?.field ?? '');
    setNumerator(nextComputed?.numerator ?? defaultSide());
    setDenominator(nextComputed?.denominator ?? defaultSide());
    setMultiplier(nextComputed?.multiplier ?? 1);
    setValueFormat(
      initial?.valueFormat || nextComputed?.format || (nextComputed?.multiplier === 100 ? 'percent' : 'auto')
    );
  }, [initial, open]);

  const isValid = !!numerator.field && !!denominator.field && !!label.trim();

  const handleSave = () => {
    if (!isValid) return;
    const computed: ComputedMetric = {
      type: 'ratio',
      numerator,
      denominator,
      multiplier,
      format: valueFormat,
    };
    onSave({
      field: label.trim().replace(/\s+/g, '_').toLowerCase(),
      aggregation: 'ratio',
      label: label.trim(),
      computed,
      valueFormat,
    });
  };

  const handleMultiplierChange = (nextMultiplier: 1 | 100) => {
    setMultiplier(nextMultiplier);
    if (nextMultiplier === 100 && valueFormat === 'auto') {
      setValueFormat('percent');
    }
  };

  const stringOptions = columnOptions.map((opt) => ({
    label: typeof opt.label === 'string' ? opt.label : String(opt.value),
    value: String(opt.value),
  }));

  return (
    <Modal
      title="fx Computed metric (ratio)"
      open={open}
      onOk={handleSave}
      onCancel={onCancel}
      okText="Add Metric"
      okButtonProps={{ disabled: !isValid }}
      width={420}
      destroyOnHidden
    >
      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
        Ratio only: (numerator ÷ denominator), optionally ×100 for a percent. Not free-form math.
      </div>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div>
          <Text style={{ fontSize: 11, fontWeight: 600 }}>Metric Name</Text>
          <Input
            size="small"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Profit Margin"
            style={{ marginTop: 4 }}
          />
        </div>

        <Divider
          style={{ margin: '4px 0', fontSize: 11 }}
          orientation="left"
          orientationMargin={0}
        >
          Formula: Numerator ÷ Denominator
        </Divider>

        <SideEditor title="Numerator" value={numerator} onChange={setNumerator} stringOptions={stringOptions} />
        <SideEditor title="Denominator" value={denominator} onChange={setDenominator} stringOptions={stringOptions} />

        <div>
          <Text style={{ fontSize: 11, fontWeight: 600 }}>Result type</Text>
          <Radio.Group
            value={multiplier}
            onChange={(e) => handleMultiplierChange(e.target.value as 1 | 100)}
            style={{ display: 'flex', gap: 12, marginTop: 4 }}
            size="small"
          >
            <Radio value={1}>Ratio (0–1)</Radio>
            <Radio value={100}>Percentage (×100)</Radio>
          </Radio.Group>
        </div>

        <div>
          <Text style={{ fontSize: 11, fontWeight: 600 }}>Display format</Text>
          <Select
            size="small"
            style={{ width: '100%', marginTop: 4 }}
            value={valueFormat}
            onChange={(v: MetricValueFormat) => setValueFormat(v)}
            options={FORMAT_OPTIONS}
          />
        </div>

        <div
          style={{
            background: 'var(--ant-color-bg-layout)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 11,
          }}
        >
          <Text type="secondary">
            Preview:{' '}
            {numerator.field
              ? `${numerator.aggregation}(${numerator.field})`
              : '…'}{' '}
            /{' '}
            {denominator.field
              ? `${denominator.aggregation}(${denominator.field})`
              : '…'}
            {multiplier === 100 ? ' × 100' : ''}
            {' · '}
            Format: {FORMAT_OPTIONS.find((option) => option.value === valueFormat)?.label || 'Auto'}
          </Text>
        </div>
      </Space>
    </Modal>
  );
}

export default ComputedMetricEditor;
