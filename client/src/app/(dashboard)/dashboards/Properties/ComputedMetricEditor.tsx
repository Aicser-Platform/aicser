'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Divider, Input, Modal, Radio, Segmented, Select, Space, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import { isEnterpriseEdition } from '@/utils/appPaths';
import type { ComputedMetricSide, ComputedMetric, ComputedOperation, MetricValueFormat } from './PropertiesPanelConfig';
import type { MetricItem } from './FormFields';

const { Text } = Typography;

/**
 * Formula builder without SQL (Tableau / Power BI style): pick two numbers and how to combine
 * them — A ÷ B, change %, A − B, A + B, A × B — or describe the metric and let AI fill it in.
 * Every formula runs on the server as one safe, portable SQL expression.
 */

const AGGS: ComputedMetricSide['aggregation'][] = ['sum', 'count', 'distinct_count', 'avg', 'min', 'max'];
const FORMATS: MetricValueFormat[] = ['auto', 'percent', 'compact', 'currency', 'full'];
const OPS: ComputedOperation[] = ['ratio', 'change', 'difference', 'sum', 'product'];
const SYMBOL: Record<ComputedOperation, string> = { ratio: '÷', change: '→ %', difference: '−', sum: '+', product: '×' };
const PERCENT_OPS = new Set<ComputedOperation>(['ratio', 'change']);

interface Props {
  open: boolean;
  initial?: MetricItem;
  columnOptions: { label: React.ReactNode; value: string; type?: string }[];
  onSave: (metric: MetricItem) => void;
  onCancel: () => void;
}

const defaultSide = (): ComputedMetricSide => ({ field: '', aggregation: 'sum' });

function SideEditor({
  title,
  value,
  onChange,
  options,
}: {
  title: string;
  value: ComputedMetricSide;
  onChange: (v: ComputedMetricSide) => void;
  options: { label: string; value: string }[];
}) {
  const t = useTranslations('formula_editor');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Text style={{ fontSize: 11, fontWeight: 600 }}>{title}</Text>
      <div style={{ display: 'flex', gap: 6 }}>
        <Select
          size="small"
          style={{ flex: 1 }}
          placeholder={t('pick_field')}
          value={value.field || undefined}
          onChange={(v: string) => onChange({ ...value, field: v })}
          options={options}
          showSearch
          filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
        />
        <Select
          size="small"
          style={{ width: 128 }}
          value={value.aggregation}
          onChange={(v: ComputedMetricSide['aggregation']) => onChange({ ...value, aggregation: v })}
          options={AGGS.map((a) => ({ value: a, label: t(`agg_${a}` as never) }))}
        />
      </div>
    </div>
  );
}

export function ComputedMetricEditor({ open, initial, columnOptions, onSave, onCancel }: Props) {
  const t = useTranslations('formula_editor');
  const locale = useLocale();
  const { message } = App.useApp();
  const existing = initial?.computed;
  const [label, setLabel] = useState('');
  const [op, setOp] = useState<ComputedOperation>('ratio');
  const [a, setA] = useState<ComputedMetricSide>(defaultSide());
  const [b, setB] = useState<ComputedMetricSide>(defaultSide());
  const [multiplier, setMultiplier] = useState<1 | 100>(1);
  const [valueFormat, setValueFormat] = useState<MetricValueFormat>('auto');
  const [describe, setDescribe] = useState('');
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(initial?.label ?? initial?.field ?? '');
    setOp((existing?.type as ComputedOperation) || 'ratio');
    setA(existing?.numerator ?? defaultSide());
    setB(existing?.denominator ?? defaultSide());
    setMultiplier(existing?.multiplier ?? 1);
    setValueFormat(initial?.valueFormat || existing?.format || (existing?.multiplier === 100 ? 'percent' : 'auto'));
    setDescribe('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, open]);

  const options = columnOptions.map((o) => ({ label: typeof o.label === 'string' ? o.label : String(o.value), value: String(o.value) }));
  const nameOf = (field: string) => options.find((o) => o.value === field)?.label || field;
  const isValid = !!a.field && !!b.field && !!label.trim();
  const percentable = PERCENT_OPS.has(op);

  const setOperation = (next: ComputedOperation) => {
    setOp(next);
    if (!PERCENT_OPS.has(next)) {
      setMultiplier(1);
      if (valueFormat === 'percent') setValueFormat('auto');
    } else if (next === 'change') {
      setMultiplier(100);
      if (valueFormat === 'auto') setValueFormat('percent');
    }
  };

  const suggest = async () => {
    if (!describe.trim()) return;
    setSuggesting(true);
    try {
      const f = await fetchApi<ComputedMetric & { label?: string }>('api/ai/formula/suggest', {
        method: 'POST',
        body: JSON.stringify({
          description: describe.trim(),
          columns: columnOptions.map((c) => ({ name: String(c.value), type: c.type })),
          locale,
        }),
      });
      setOp(f.type);
      setA(f.numerator);
      setB(f.denominator);
      setMultiplier(f.multiplier ?? 1);
      setValueFormat(f.format || (f.multiplier === 100 ? 'percent' : 'auto'));
      if (!label.trim() && f.label) setLabel(f.label);
      message.success(t('suggest_ok'));
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : t('suggest_failed'));
    } finally {
      setSuggesting(false);
    }
  };

  const save = () => {
    if (!isValid) return;
    const computed: ComputedMetric = {
      type: op,
      numerator: a,
      denominator: b,
      multiplier: percentable ? multiplier : 1,
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

  const sideText = (s: ComputedMetricSide) => (s.field ? `${t(`agg_${s.aggregation}` as never)} ${nameOf(s.field)}` : '…');
  const preview =
    op === 'change'
      ? t('preview_change', { a: sideText(a), b: sideText(b) })
      : `${sideText(a)} ${SYMBOL[op]} ${sideText(b)}${percentable && multiplier === 100 ? ' × 100' : ''}`;

  return (
    <Modal
      title={t('title')}
      open={open}
      onOk={save}
      onCancel={onCancel}
      okText={initial?.computed ? t('save') : t('add')}
      okButtonProps={{ disabled: !isValid }}
      width={580}
      destroyOnHidden
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {isEnterpriseEdition() ? (
          <div>
            <Text style={{ fontSize: 11, fontWeight: 600 }}>{t('describe')}</Text>
            <Space.Compact style={{ width: '100%', marginTop: 4 }}>
              <Input
                size="small"
                id="formula-describe"
                value={describe}
                onChange={(e) => setDescribe(e.target.value)}
                onPressEnter={() => void suggest()}
                placeholder={t('describe_placeholder')}
              />
              <Button size="small" icon={<ThunderboltOutlined />} loading={suggesting} onClick={() => void suggest()}>
                {t('suggest')}
              </Button>
            </Space.Compact>
          </div>
        ) : null}

        <div>
          <Text style={{ fontSize: 11, fontWeight: 600 }}>{t('name')}</Text>
          <Input size="small" id="formula-name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('name_placeholder')} style={{ marginTop: 4 }} />
        </div>

        <Divider style={{ margin: '4px 0', fontSize: 11 }} titlePlacement="left" styles={{ content: { margin: 0 } }}>
          {t('formula')}
        </Divider>

        <SideEditor title={t('first_number')} value={a} onChange={setA} options={options} />
        <Segmented
          block
          size="small"
          value={op}
          onChange={(v) => setOperation(v as ComputedOperation)}
          options={OPS.map((o) => ({ value: o, label: t(`op_${o}` as never) }))}
        />
        <SideEditor title={t('second_number')} value={b} onChange={setB} options={options} />

        {percentable ? (
          <div>
            <Text style={{ fontSize: 11, fontWeight: 600 }}>{t('result')}</Text>
            <Radio.Group
              value={multiplier}
              onChange={(e) => {
                const m = e.target.value as 1 | 100;
                setMultiplier(m);
                if (m === 100 && valueFormat === 'auto') setValueFormat('percent');
              }}
              style={{ display: 'flex', gap: 12, marginTop: 4 }}
              size="small"
            >
              <Radio value={1}>{t('result_ratio')}</Radio>
              <Radio value={100}>{t('result_percent')}</Radio>
            </Radio.Group>
          </div>
        ) : null}

        <div>
          <Text style={{ fontSize: 11, fontWeight: 600 }}>{t('format')}</Text>
          <Select
            size="small"
            style={{ width: '100%', marginTop: 4 }}
            value={valueFormat}
            onChange={(v: MetricValueFormat) => setValueFormat(v)}
            options={FORMATS.map((f) => ({ value: f, label: t(`format_${f}` as never) }))}
          />
        </div>

        <div style={{ background: 'var(--ant-color-fill-quaternary)', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
          <Text type="secondary">{t('preview')}: </Text>
          <Text>{preview}</Text>
        </div>
      </Space>
    </Modal>
  );
}

export default ComputedMetricEditor;
