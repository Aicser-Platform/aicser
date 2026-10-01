'use client';

import React, { useState } from 'react';
import {
  Table,
  Dropdown,
  Button,
  Space,
  Tag,
  Typography,
  Tooltip,
  message,
  Popover,
  Progress,
  Badge,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  DownOutlined,
  ThunderboltOutlined,
  FilterOutlined,
  KeyOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ScissorOutlined,
  FieldStringOutlined,
  CalculatorOutlined,
  SafetyCertificateOutlined,
  DeleteOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { type ColumnProfile } from '../data/mockPipelineData';

const { Text } = Typography;

interface VisualDataPrepGridProps {
  columns: ColumnProfile[];
  sampleRows: Record<string, any>[];
  onApplyTransform?: (transformName: string, columnName: string) => void;
}

export function VisualDataPrepGrid({ columns, sampleRows, onApplyTransform }: VisualDataPrepGridProps) {
  const [activeColumns, setActiveColumns] = useState<ColumnProfile[]>(columns);
  const [rows, setRows] = useState<Record<string, any>[]>(sampleRows);

  const handleActionClick = (actionKey: string, colName: string) => {
    let actionDesc = '';
    if (actionKey === 'clean_currency') {
      actionDesc = `Cleaned currency & stripped symbols on column "${colName}"`;
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          [colName]: typeof r[colName] === 'string' ? r[colName].replace(/[$,\s]/g, '') : r[colName],
        }))
      );
    } else if (actionKey === 'trim_lower') {
      actionDesc = `Trimmed whitespace & lowercased column "${colName}"`;
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          [colName]: typeof r[colName] === 'string' ? r[colName].trim().toLowerCase() : r[colName],
        }))
      );
    } else if (actionKey === 'cast_decimal') {
      actionDesc = `Casted column "${colName}" to DECIMAL(12,2)`;
    } else if (actionKey === 'fill_zero') {
      actionDesc = `Filled missing values with 0.00 on column "${colName}"`;
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          [colName]: r[colName] === null || r[colName] === undefined ? '0.00' : r[colName],
        }))
      );
    } else if (actionKey === 'add_expectation_not_null') {
      actionDesc = `Added Quality Expectation: Assert NOT NULL on "${colName}"`;
    } else if (actionKey === 'extract_month') {
      actionDesc = `Derived new column "${colName}_month" via strftime('%Y-%m')`;
    } else {
      actionDesc = `Applied data prep action "${actionKey}" on "${colName}"`;
    }

    message.success({ content: `[Visual Data Prep] ${actionDesc}`, key: 'prep' });
    if (onApplyTransform) onApplyTransform(actionKey, colName);
  };

  const getColumnMenu = (col: ColumnProfile): MenuProps => ({
    items: [
      {
        key: 'group_clean',
        label: '🧹 Clean & Standardize',
        type: 'group',
        children: [
          {
            key: 'clean_currency',
            label: 'Strip Currency Symbols ($ , €)',
            icon: <ThunderboltOutlined style={{ color: '#00c2cb' }} />,
            onClick: () => handleActionClick('clean_currency', col.name),
          },
          {
            key: 'trim_lower',
            label: 'Trim Whitespace & Lowercase',
            icon: <FieldStringOutlined />,
            onClick: () => handleActionClick('trim_lower', col.name),
          },
        ],
      },
      { type: 'divider' },
      {
        key: 'group_type',
        label: '🔄 Cast & Convert Type',
        type: 'group',
        children: [
          {
            key: 'cast_decimal',
            label: 'Cast to Decimal (12,2)',
            onClick: () => handleActionClick('cast_decimal', col.name),
          },
          {
            key: 'cast_date',
            label: 'Cast to Date (YYYY-MM-DD)',
            onClick: () => handleActionClick('cast_date', col.name),
          },
          {
            key: 'cast_int',
            label: 'Cast to Integer',
            onClick: () => handleActionClick('cast_int', col.name),
          },
        ],
      },
      { type: 'divider' },
      {
        key: 'group_missing',
        label: '🧩 Missing & Null Values',
        type: 'group',
        children: [
          {
            key: 'fill_zero',
            label: 'Fill Nulls with 0 / Default',
            onClick: () => handleActionClick('fill_zero', col.name),
          },
          {
            key: 'fill_median',
            label: 'Impute with Column Median',
            onClick: () => handleActionClick('fill_median', col.name),
          },
          {
            key: 'drop_nulls',
            label: 'Drop Rows with Null',
            danger: true,
            onClick: () => handleActionClick('drop_nulls', col.name),
          },
        ],
      },
      { type: 'divider' },
      {
        key: 'group_contract',
        label: '🛡️ Data Quality Contract',
        type: 'group',
        children: [
          {
            key: 'add_expectation_not_null',
            label: 'Add Rule: Assert NOT NULL',
            icon: <SafetyCertificateOutlined style={{ color: '#10b981' }} />,
            onClick: () => handleActionClick('add_expectation_not_null', col.name),
          },
          {
            key: 'add_expectation_unique',
            label: 'Add Rule: Assert Primary Key Uniqueness',
            icon: <KeyOutlined style={{ color: '#f59e0b' }} />,
            onClick: () => handleActionClick('add_expectation_unique', col.name),
          },
        ],
      },
    ],
  });

  const tableColumns = columns.map((col) => {
    const stats = col.stats;
    const validPct = stats?.validPercent ?? 100;
    const nullPct = stats?.nullPercent ?? 0;
    const invalidPct = stats?.invalidPercent ?? 0;

    return {
      title: (
        <div style={{ padding: '4px 0', minWidth: 155 }}>
          {/* Header Top Row: Name + Dropdown Palette */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <Space size={4}>
              <Text strong style={{ fontSize: 12 }}>{col.name}</Text>
              {col.isPk && <Tag color="gold" style={{ fontSize: 9, padding: '0 4px', margin: 0 }}>PK</Tag>}
              {col.isMetric && <Tag color="purple" style={{ fontSize: 9, padding: '0 4px', margin: 0 }}>Metric</Tag>}
            </Space>

            <Dropdown menu={getColumnMenu(col)} trigger={['click']}>
              <Button
                size="small"
                type="text"
                icon={<DownOutlined style={{ fontSize: 10, color: '#64748b' }} />}
                style={{ height: 22, width: 22, padding: 0 }}
              />
            </Dropdown>
          </div>

          {/* Type Tag */}
          <div style={{ marginBottom: 6 }}>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: 10,
                color: '#64748b',
                background: 'rgba(0,0,0,0.04)',
                padding: '1px 5px',
                borderRadius: 4,
              }}
            >
              {col.type}
            </span>
          </div>

          {/* Quality Distribution Bar */}
          <Tooltip title={`Valid: ${validPct}% | Null: ${nullPct}% | Outlier: ${invalidPct}%`}>
            <div
              style={{
                height: 4,
                width: '100%',
                borderRadius: 2,
                display: 'flex',
                overflow: 'hidden',
                background: '#e2e8f0',
                marginBottom: 6,
              }}
            >
              <div style={{ width: `${validPct}%`, background: '#10b981' }} />
              {nullPct > 0 && <div style={{ width: `${nullPct}%`, background: '#94a3b8' }} />}
              {invalidPct > 0 && <div style={{ width: `${invalidPct}%`, background: '#ef4444' }} />}
            </div>
          </Tooltip>

          {/* Distribution Histogram / Frequency Indicators */}
          {stats?.distribution && stats.distribution.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', height: 16, gap: 2 }}>
              {stats.distribution.map((d, i) => (
                <Tooltip key={i} title={`${d.label}: ${d.count.toLocaleString()} (${d.percent}%)`}>
                  <div
                    style={{
                      flex: 1,
                      height: `${Math.max(15, d.percent)}%`,
                      background: '#00c2cb',
                      opacity: 0.6 + (i * 0.1),
                      borderRadius: 1,
                    }}
                  />
                </Tooltip>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#94a3b8' }}>
              {stats?.distinctCount ? `${stats.distinctCount.toLocaleString()} distinct` : '100% profiled'}
            </div>
          )}
        </div>
      ),
      dataIndex: col.name,
      key: col.name,
      render: (val: any) => {
        if (val === null || val === undefined) {
          return <span style={{ color: '#ef4444', fontStyle: 'italic', fontSize: 11 }}>null</span>;
        }
        return <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{String(val)}</span>;
      },
    };
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Table
        dataSource={rows}
        columns={tableColumns}
        pagination={false}
        size="small"
        rowKey={(r, idx) => `r-${idx}`}
        scroll={{ x: 'max-content', y: 150 }}
        style={{ border: 'none' }}
      />
    </div>
  );
}
