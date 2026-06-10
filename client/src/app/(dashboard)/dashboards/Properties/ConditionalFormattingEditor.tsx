'use client';

import React from 'react';
import {
  Button,
  Select,
  Input,
  ColorPicker,
  Tooltip,
  Space,
  Tag,
  Divider,
  Checkbox,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  BgColorsOutlined,
  FontColorsOutlined,
} from '@ant-design/icons';
import { nanoid } from 'nanoid';

export interface ConditionalFormattingRule {
  id: string;
  /** Column key: 'x', 'y', series name, or '*' for whole-row */
  column: string;
  operator:
    | 'gt'
    | 'lt'
    | 'gte'
    | 'lte'
    | 'eq'
    | 'neq'
    | 'contains'
    | 'not_empty'
    | 'is_empty';
  /** Value to compare against (stored as string, parsed at render time) */
  value: string;
  bgColor?: string;
  textColor?: string;
  bold?: boolean;
  applyTo: 'cell' | 'row';
}

interface ColumnOption {
  label: string;
  value: string;
}

interface ConditionalFormattingEditorProps {
  rules: ConditionalFormattingRule[];
  onChange: (rules: ConditionalFormattingRule[]) => void;
  /** Available columns derived from chartQuery */
  columnOptions: ColumnOption[];
}

const OPERATOR_OPTIONS = [
  { label: '> greater than', value: 'gt' },
  { label: '< less than', value: 'lt' },
  { label: '≥ at least', value: 'gte' },
  { label: '≤ at most', value: 'lte' },
  { label: '= equals', value: 'eq' },
  { label: '≠ not equal', value: 'neq' },
  { label: 'contains', value: 'contains' },
  { label: 'is empty', value: 'is_empty' },
  { label: 'is not empty', value: 'not_empty' },
];

const VALUE_FREE_OPERATORS = new Set(['is_empty', 'not_empty']);

function defaultRule(columnOptions: ColumnOption[]): ConditionalFormattingRule {
  return {
    id: nanoid(8),
    column: columnOptions[0]?.value ?? 'y',
    operator: 'gt',
    value: '',
    bgColor: '#fff7e6',
    textColor: undefined,
    bold: false,
    applyTo: 'cell',
  };
}

export const ConditionalFormattingEditor: React.FC<ConditionalFormattingEditorProps> = ({
  rules,
  onChange,
  columnOptions,
}) => {
  const updateRule = (id: string, patch: Partial<ConditionalFormattingRule>) => {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRule = (id: string) => {
    onChange(rules.filter((r) => r.id !== id));
  };

  const addRule = () => {
    onChange([...rules, defaultRule(columnOptions)]);
  };

  if (rules.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
          Highlight cells or rows based on value conditions.
        </span>
        <Button size="small" icon={<PlusOutlined />} onClick={addRule} block type="dashed">
          Add Rule
        </Button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
        Rules are evaluated top-to-bottom; first match wins.
      </span>

      {rules.map((rule, index) => (
        <div key={rule.id} className="cf-rule-card">
          {/* Rule number header */}
          <div className="cf-rule-header">
            <Tag color="processing" style={{ margin: 0, fontSize: 11 }}>
              Rule {index + 1}
            </Tag>
            <Space size={4}>
              <Select
                size="small"
                value={rule.applyTo}
                onChange={(v) => updateRule(rule.id, { applyTo: v })}
                options={[
                  { label: 'Cell', value: 'cell' },
                  { label: 'Row', value: 'row' },
                ]}
                style={{ width: 72 }}
                popupMatchSelectWidth={false}
              />
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeRule(rule.id)}
              />
            </Space>
          </div>

          {/* Condition row */}
          <div className="cf-rule-condition">
            <Select
              size="small"
              value={rule.column}
              onChange={(v) => updateRule(rule.id, { column: v })}
              options={columnOptions}
              style={{ minWidth: 90, flex: 1 }}
              placeholder="Column"
            />
            <Select
              size="small"
              value={rule.operator}
              onChange={(v) => updateRule(rule.id, { operator: v as ConditionalFormattingRule['operator'] })}
              options={OPERATOR_OPTIONS}
              style={{ minWidth: 110 }}
              popupMatchSelectWidth={false}
            />
            {!VALUE_FREE_OPERATORS.has(rule.operator) && (
              <Input
                size="small"
                value={rule.value}
                onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                placeholder="value"
                style={{ width: 70 }}
              />
            )}
          </div>

          {/* Style row */}
          <div className="cf-rule-style">
            <Tooltip title="Background color">
              <ColorPicker
                size="small"
                value={rule.bgColor || 'transparent'}
                onChange={(c) => updateRule(rule.id, { bgColor: c.toHexString() })}
              >
                <Button
                  size="small"
                  icon={<BgColorsOutlined />}
                  style={{
                    background: rule.bgColor || 'transparent',
                    border: '1px solid var(--ant-color-border)',
                    color: rule.bgColor ? '#000' : undefined,
                    minWidth: 28,
                  }}
                />
              </ColorPicker>
            </Tooltip>
            <Tooltip title="Text color">
              <ColorPicker
                size="small"
                value={rule.textColor || '#000000'}
                onChange={(c) => updateRule(rule.id, { textColor: c.toHexString() })}
              >
                <Button
                  size="small"
                  icon={<FontColorsOutlined />}
                  style={{
                    borderBottom: rule.textColor ? `3px solid ${rule.textColor}` : undefined,
                    minWidth: 28,
                  }}
                />
              </ColorPicker>
            </Tooltip>
            <Checkbox
              checked={rule.bold === true}
              onChange={(e) => updateRule(rule.id, { bold: e.target.checked })}
              style={{ fontSize: 12 }}
            >
              Bold
            </Checkbox>
            {/* Quick-clear style buttons */}
            {(rule.bgColor || rule.textColor || rule.bold) && (
              <Button
                type="link"
                size="small"
                style={{ fontSize: 11, padding: 0 }}
                onClick={() => updateRule(rule.id, { bgColor: undefined, textColor: undefined, bold: false })}
              >
                Clear style
              </Button>
            )}
          </div>
        </div>
      ))}

      <Divider style={{ margin: '4px 0' }} />

      <Button size="small" icon={<PlusOutlined />} onClick={addRule} block type="dashed">
        Add Rule
      </Button>
    </div>
  );
};

export default ConditionalFormattingEditor;
