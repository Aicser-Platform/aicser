'use client';

import React from 'react';
import { AutoComplete, Button, Card, Col, Input, Row, Select, Tooltip, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import AccessSentence from '../AccessSentence';
import type { SchemaInfo } from '@/stores/useDataSourceStore';
import {
  RLS_OPERATORS,
  RLS_VALUE_TYPES,
  attributeKeyOptions,
  columnOptionsFor,
  isNullOperator,
  tableOptionsFor,
  type RuleFormValue,
} from './policyForm';

const { Text } = Typography;

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontSize: 13,
};

/**
 * One row filter rule: table / column / operator / value type / value, plus
 * the sentence that reads it back in plain English. Holds no state of its
 * own — it reports the whole next rule upward on every field edit.
 */
export const RuleCard: React.FC<{
  index: number;
  rule: RuleFormValue;
  schema: SchemaInfo | null;
  /** Keys available for the currently-simulated project (project_attribute rows). */
  projectAttributeKeys?: string[];
  /** False disables + explains the delete button — a policy needs at least one rule. */
  canRemove?: boolean;
  onChange: (rule: RuleFormValue) => void;
  onRemove: () => void;
}> = ({ index, rule, schema, projectAttributeKeys = [], canRemove = true, onChange, onRemove }) => {
  const t = useTranslations('data_source_detail');
  const schemaTables = tableOptionsFor(schema);
  const schemaAvailable = schemaTables.length > 0;
  const columnOptions = columnOptionsFor(schema, rule.table_name ?? '');
  const operator = rule.operator ?? 'eq';
  const valueType = rule.value_type ?? 'user_attribute';

  const set = <K extends keyof RuleFormValue>(key: K, value: RuleFormValue[K]) => {
    onChange({ ...rule, [key]: value });
  };

  return (
    <Card
      size="small"
      style={{ marginBottom: 10 }}
      title={<span style={{ fontSize: 13 }}>{t('rule_n', { n: index + 1 })}</span>}
      extra={
        <Tooltip title={canRemove ? undefined : t('policy_editor_last_rule_hint')}>
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!canRemove}
            onClick={onRemove}
          />
        </Tooltip>
      }
    >
      <Row gutter={[10, 12]}>
        <Col xs={24} sm={12} lg={6} xxl={5}>
          <Text style={fieldLabelStyle}>{t('data_source_rls_table')}</Text>
          {schemaAvailable ? (
            <Select
              style={{ width: '100%' }}
              showSearch
              options={schemaTables}
              value={rule.table_name || undefined}
              onChange={(value) => set('table_name', value)}
            />
          ) : (
            <AutoComplete
              style={{ width: '100%' }}
              placeholder={t('data_source_rls_table')}
              value={rule.table_name}
              onChange={(value) => set('table_name', value)}
            />
          )}
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Text style={fieldLabelStyle}>{t('data_source_rls_column')}</Text>
          {schemaAvailable ? (
            <Select
              style={{ width: '100%' }}
              showSearch
              options={columnOptions}
              value={rule.column_name || undefined}
              onChange={(value) => set('column_name', value)}
            />
          ) : (
            <AutoComplete
              style={{ width: '100%' }}
              placeholder={t('data_source_rls_column')}
              value={rule.column_name}
              onChange={(value) => set('column_name', value)}
            />
          )}
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Text style={fieldLabelStyle}>{t('data_source_rls_operator')}</Text>
          <Select
            style={{ width: '100%' }}
            value={operator}
            onChange={(value) => set('operator', value)}
            options={RLS_OPERATORS.map((value) => ({
              value,
              label: t(`data_source_rls_operator_${value}`),
            }))}
          />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Text style={fieldLabelStyle}>{t('data_source_rls_value_type')}</Text>
          <Select
            style={{ width: '100%' }}
            value={valueType}
            onChange={(value) => set('value_type', value)}
            options={RLS_VALUE_TYPES.map((value) => ({
              value,
              label: t(`data_source_rls_value_type_${value}`),
            }))}
          />
        </Col>
        <Col xs={24} sm={8} lg={4} xxl={5}>
          {!isNullOperator(operator) ? (
            <>
              <Text style={fieldLabelStyle}>
                {valueType === 'fixed' ? t('data_source_rls_value') : t('attribute_key_label')}
              </Text>
              {valueType === 'fixed' ? (
                <Input
                  placeholder={t('data_source_rls_value_fixed_placeholder')}
                  value={rule.value}
                  onChange={(event) => set('value', event.target.value)}
                />
              ) : (
                <Select
                  style={{ width: '100%' }}
                  showSearch
                  allowClear
                  placeholder={t('data_source_rls_value_attribute_placeholder')}
                  value={rule.value || undefined}
                  onChange={(value) => set('value', value ?? '')}
                  options={attributeKeyOptions(valueType, projectAttributeKeys)}
                />
              )}
            </>
          ) : null}
        </Col>
      </Row>

      <AccessSentence rule={rule} />
    </Card>
  );
};

export default RuleCard;
