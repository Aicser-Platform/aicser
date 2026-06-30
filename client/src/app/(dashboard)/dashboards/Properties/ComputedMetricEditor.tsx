'use client';

import React, { useState } from 'react';
import { Modal, Select, Radio, Input, Space, Divider, Typography } from 'antd';
import type { ComputedMetricSide, ComputedMetric } from './PropertiesPanelConfig';
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

interface Props {
  open: boolean;
  initial?: MetricItem;
  columnOptions: { label: React.ReactNode; value: string; type?: string }[];
  onSave: (metric: MetricItem) => void;
  onCancel: () => void;
}

const defaultSide = (): ComputedMetricSide => ({ field: '', aggregation: 'sum' });

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

  const isValid = !!numerator.field && !!denominator.field && !!label.trim();

  const handleSave = () => {
    if (!isValid) return;
    const computed: ComputedMetric = {
      type: 'ratio',
      numerator,
      denominator,
      multiplier,
    };
    onSave({
      field: label.trim().replace(/\s+/g, '_').toLowerCase(),
      aggregation: 'ratio',
      label: label.trim(),
      computed,
    });
  };

  const stringOptions = columnOptions.map((opt) => ({
    ...opt,
    label: typeof opt.label === 'string' ? opt.label : String(opt.label ?? opt.value),
  }));

  const SideEditor = ({
    title,
    value,
    onChange,
  }: {
    title: string;
    value: ComputedMetricSide;
    onChange: (v: ComputedMetricSide) => void;
  }) => (
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

  return (
    <Modal
      title="fx Computed Metric"
      open={open}
      onOk={handleSave}
      onCancel={onCancel}
      okText="Add Metric"
      okButtonProps={{ disabled: !isValid }}
      width={420}
      destroyOnClose
    >
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

        <SideEditor title="Numerator" value={numerator} onChange={setNumerator} />
        <SideEditor title="Denominator" value={denominator} onChange={setDenominator} />

        <div>
          <Text style={{ fontSize: 11, fontWeight: 600 }}>Result type</Text>
          <Radio.Group
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value as 1 | 100)}
            style={{ display: 'flex', gap: 12, marginTop: 4 }}
            size="small"
          >
            <Radio value={1}>Ratio (0–1)</Radio>
            <Radio value={100}>Percentage (×100)</Radio>
          </Radio.Group>
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
          </Text>
        </div>
      </Space>
    </Modal>
  );
}

export default ComputedMetricEditor;
