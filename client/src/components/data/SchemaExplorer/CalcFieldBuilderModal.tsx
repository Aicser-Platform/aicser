'use client';

import React, { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Radio, Select, Space, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import { computedMetricToExpression } from '@/utils/computedMetricExpression';
import type { ComputedMetricSide, ComputedOperation } from '@/app/(dashboard)/dashboards/Properties/PropertiesPanelConfig';

const { Text } = Typography;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const AGGS: ComputedMetricSide['aggregation'][] = ['sum', 'count', 'distinct_count', 'avg', 'min', 'max'];
const OPS: ComputedOperation[] = ['ratio', 'change', 'difference', 'sum', 'product'];

type Props = {
  open: boolean;
  columnOptions: { label: string; value: string; type?: string }[];
  onCancel: () => void;
  onSave: (payload: { name: string; expression: string; description: string }) => void;
};

const defaultSide = (): ComputedMetricSide => ({ field: '', aggregation: 'sum' });

export function CalcFieldBuilderModal({ open, columnOptions, onCancel, onSave }: Props) {
  const t = useTranslations('schema_explorer');
  const tFx = useTranslations('formula_editor');
  const locale = useLocale();
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple');
  const [label, setLabel] = useState('');
  const [op, setOp] = useState<ComputedOperation>('ratio');
  const [a, setA] = useState<ComputedMetricSide>(defaultSide());
  const [b, setB] = useState<ComputedMetricSide>(defaultSide());
  const [describe, setDescribe] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [form] = Form.useForm<{ name: string; expression: string; description?: string }>();

  const options = columnOptions.map((o) => ({ label: o.label, value: o.value }));
  const simpleValid = Boolean(label.trim() && a.field && b.field);

  const buildSimpleExpression = () => {
    const expression = computedMetricToExpression({
      type: op,
      numerator: a,
      denominator: b,
      multiplier: op === 'change' || op === 'ratio' ? (op === 'change' ? 100 : 1) : 1,
    });
    return expression;
  };

  const suggest = async () => {
    if (!describe.trim() || !columnOptions.length) return;
    setSuggesting(true);
    try {
      const f = await fetchApi<{
        type: ComputedOperation;
        numerator: ComputedMetricSide;
        denominator: ComputedMetricSide;
        label?: string;
      }>('/api/ai/formula/suggest', {
        method: 'POST',
        body: JSON.stringify({
          description: describe.trim(),
          columns: columnOptions.map((c) => ({ name: c.value, type: c.type })),
          locale,
        }),
      });
      setOp(f.type);
      setA(f.numerator);
      setB(f.denominator);
      if (!label.trim() && f.label) setLabel(f.label);
    } finally {
      setSuggesting(false);
    }
  };

  const submit = async () => {
    if (mode === 'simple') {
      const expression = buildSimpleExpression();
      if (!expression) return;
      const name = label.trim().replace(/\s+/g, '_').toLowerCase();
      if (!NAME_PATTERN.test(name)) return;
      onSave({ name, expression, description: label.trim() });
      return;
    }
    const values = await form.validateFields();
    onSave({
      name: values.name.trim(),
      expression: values.expression.trim(),
      description: values.description?.trim() || '',
    });
  };

  return (
    <Modal
      title={t('calc_modal_title')}
      open={open}
      onCancel={onCancel}
      onOk={() => void submit()}
      okText={t('calc_modal_save')}
      width={520}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('calc_save_where_hint')} />
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        optionType="button"
        buttonStyle="solid"
        style={{ marginBottom: 12 }}
        options={[
          { label: t('calc_mode_simple'), value: 'simple' },
          { label: t('calc_mode_advanced'), value: 'advanced' },
        ]}
      />
      {mode === 'simple' ? (
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          {!columnOptions.length ? (
            <Alert type="warning" showIcon message={t('calc_no_columns')} />
          ) : null}
          <Input placeholder={t('calc_field_name')} value={label} onChange={(e) => setLabel(e.target.value)} />
          <Select
            value={op}
            onChange={setOp}
            options={OPS.map((o) => ({ value: o, label: tFx(`op_${o}` as never) }))}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              placeholder={tFx('pick_field')}
              style={{ flex: 1 }}
              value={a.field || undefined}
              onChange={(v) => setA({ ...a, field: v })}
              options={options}
              showSearch
            />
            <Select
              style={{ width: 110 }}
              value={a.aggregation}
              onChange={(v) => setA({ ...a, aggregation: v })}
              options={AGGS.map((x) => ({ value: x, label: tFx(`agg_${x}` as never) }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              placeholder={tFx('pick_field')}
              style={{ flex: 1 }}
              value={b.field || undefined}
              onChange={(v) => setB({ ...b, field: v })}
              options={options}
              showSearch
            />
            <Select
              style={{ width: 110 }}
              value={b.aggregation}
              onChange={(v) => setB({ ...b, aggregation: v })}
              options={AGGS.map((x) => ({ value: x, label: tFx(`agg_${x}` as never) }))}
            />
          </div>
          <Input.TextArea
            placeholder={t('calc_describe_placeholder')}
            value={describe}
            onChange={(e) => setDescribe(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 3 }}
          />
          <Button
            icon={<ThunderboltOutlined />}
            loading={suggesting}
            disabled={!describe.trim()}
            onClick={() => void suggest()}
          >
            {t('calc_ai_fill')}
          </Button>
          {simpleValid && buildSimpleExpression() ? (
            <Text type="secondary" code style={{ fontSize: 11 }}>{buildSimpleExpression()}</Text>
          ) : null}
        </Space>
      ) : (
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('calc_field_name')}
            rules={[
              { required: true, message: t('calc_field_name_required') },
              { pattern: NAME_PATTERN, message: t('calc_field_name_pattern') },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="expression"
            label={t('calc_expression')}
            tooltip={t('calc_expression_tooltip')}
            rules={[{ required: true, message: t('calc_expression_required') }]}
          >
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="SUM(amount) / COUNT(*)" />
          </Form.Item>
          <Form.Item name="description" label={t('calc_description')}>
            <Input placeholder={t('calc_description_placeholder')} />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
