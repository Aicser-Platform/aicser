'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Segmented, Select, Space } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

export type Condition = { column: string; op: string; value?: string; value2?: string };

export const CONDITION_OPS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'is_empty',
  'not_empty',
  'in_list',
  'matches',
] as const;

const NO_VALUE = new Set(['is_empty', 'not_empty']);

/** Rows that match all (or any) of these conditions. Values are compared without case. */
export function ConditionBuilder({
  columns,
  value,
  onChange,
  match,
  onMatchChange,
}: {
  columns: string[];
  value: Condition[];
  onChange: (next: Condition[]) => void;
  match: 'all' | 'any';
  onMatchChange: (next: 'all' | 'any') => void;
}) {
  const t = useTranslations('prepare');
  const set = (i: number, patch: Partial<Condition>) => onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      {value.length > 1 ? (
        <Segmented
          size="small"
          value={match}
          onChange={(v) => onMatchChange(v as 'all' | 'any')}
          options={[
            { value: 'all', label: t('match_all') },
            { value: 'any', label: t('match_any') },
          ]}
        />
      ) : null}
      {value.map((c, i) => (
        <Space key={i} wrap size={6} style={{ width: '100%' }}>
          <Select
            size="small"
            showSearch
            style={{ minWidth: 160 }}
            value={c.column || undefined}
            placeholder={t('field_column')}
            onChange={(column) => set(i, { column })}
            options={columns.map((col) => ({ value: col, label: col }))}
            aria-label={t('field_column')}
          />
          <Select
            size="small"
            style={{ minWidth: 150 }}
            value={c.op}
            onChange={(op) => set(i, { op })}
            options={CONDITION_OPS.map((op) => ({ value: op, label: t(`op_${op}`) }))}
            aria-label={t('field_condition')}
          />
          {NO_VALUE.has(c.op) ? null : (
            <Input
              size="small"
              style={{ width: 160 }}
              value={c.value}
              placeholder={c.op === 'in_list' ? t('placeholder_in_list') : c.op === 'matches' ? t('placeholder_regex') : t('placeholder_value')}
              onChange={(e) => set(i, { value: e.target.value })}
              aria-label={t('field_value')}
            />
          )}
          {c.op === 'between' ? (
            <Input
              size="small"
              style={{ width: 140 }}
              value={c.value2}
              placeholder={t('placeholder_and')}
              onChange={(e) => set(i, { value2: e.target.value })}
              aria-label={t('field_value')}
            />
          ) : null}
          <Button
            size="small"
            type="text"
            icon={<DeleteOutlined />}
            aria-label={t('remove_condition')}
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            disabled={value.length === 1}
          />
        </Space>
      ))}
      <Button size="small" icon={<PlusOutlined />} onClick={() => onChange([...value, { column: columns[0] ?? '', op: 'equals' }])}>
        {t('add_condition')}
      </Button>
    </Space>
  );
}

export const conditionsComplete = (conds: Condition[]) =>
  conds.length > 0 &&
  conds.every((c) => c.column && c.op && (NO_VALUE.has(c.op) || (c.value ?? '').trim() !== '') && (c.op !== 'between' || (c.value2 ?? '').trim() !== ''));
