'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Empty, Select, Spin, Tag, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import {
  AppstoreOutlined,
  CheckOutlined,
  DatabaseOutlined,
  FieldStringOutlined,
  PlusOutlined,
  ReloadOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useDataSources, useDataSourceSchema, dataSourceKeys } from '@/hooks/useDataSources';
import { setDashboardFieldDragData } from '../../../utils/dashboardFieldDrag';

const { Text } = Typography;

type DisplayColumn = {
  name: string;
  type: string;
  nullable?: boolean;
  primary_key?: boolean;
  foreign_key?: string;
};

type DisplayTable = {
  id: string;
  name: string;
  schema?: string;
  rowCount?: number | null;
  columns: DisplayColumn[];
};

function normalizeType(type: string): string {
  const upper = type.toUpperCase();
  if (upper.includes('INT')) return 'Number';
  if (upper.includes('DECIMAL') || upper.includes('NUMERIC') || upper.includes('DOUBLE') || upper.includes('FLOAT')) return 'Decimal';
  if (upper.includes('DATE') || upper.includes('TIME')) return 'Date';
  if (upper.includes('BOOL')) return 'Boolean';
  return 'Text';
}

function tableId(table: { name?: string; schema?: string }): string {
  const name = String(table.name || '').trim();
  const schema = String(table.schema || '').trim();
  if (!schema || schema === 'public' || schema === 'file') return name;
  return `${schema}.${name}`;
}

function normalizeTables(schema: unknown): DisplayTable[] {
  const rawTables = ((schema as { tables?: unknown[] } | null)?.tables ?? []) as Array<{
    name?: string;
    schema?: string;
    rowCount?: number | null;
    row_count?: number | null;
    columns?: Array<DisplayColumn | string>;
  }>;

  return rawTables
    .map((table): DisplayTable | null => {
      const name = String(table.name || '').trim();
      if (!name) return null;
      const id = tableId(table);
      const normalizedTable: DisplayTable = {
        id,
        name,
        rowCount: table.rowCount ?? table.row_count ?? null,
        columns: (table.columns ?? [])
          .map((column): DisplayColumn | null => {
            if (typeof column === 'string') {
              return { name: column, type: 'string', nullable: true };
            }
            const columnName = String(column?.name || '').trim();
            if (!columnName) return null;
            const normalizedColumn: DisplayColumn = {
              name: columnName,
              type: String(column?.type || 'string'),
              nullable: column?.nullable ?? true,
            };
            if (column?.primary_key !== undefined) normalizedColumn.primary_key = column.primary_key;
            if (column?.foreign_key !== undefined) normalizedColumn.foreign_key = column.foreign_key;
            return normalizedColumn;
          })
          .filter((column): column is DisplayColumn => Boolean(column)),
      };
      if (table.schema !== undefined) normalizedTable.schema = table.schema;
      return normalizedTable;
    })
    .filter((table): table is DisplayTable => Boolean(table));
}

export function DataSection() {
  const t = useTranslations('dashboards_page');
  const qc = useQueryClient();
  const { dataSources, isLoading } = useDataSources();
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [selectedColumnName, setSelectedColumnName] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSourceId && dataSources[0]?.id) {
      setActiveSourceId(dataSources[0].id);
    }
  }, [activeSourceId, dataSources]);

  const { schema, isLoading: schemaLoading, error } = useDataSourceSchema(activeSourceId);
  const tables = useMemo(() => normalizeTables(schema), [schema]);
  const activeTable = tables.find((table) => table.id === activeTableId) ?? tables[0] ?? null;
  const selectedColumn =
    activeTable?.columns.find((column) => column.name === selectedColumnName) ??
    activeTable?.columns[0] ??
    null;

  useEffect(() => {
    if (activeTable && activeTable.id !== activeTableId) {
      setActiveTableId(activeTable.id);
      setSelectedColumnName(activeTable.columns[0]?.name ?? null);
    }
  }, [activeTable, activeTableId]);

  if (isLoading) {
    return (
      <div className="data-workbench-loading">
        <Spin size="small" />
      </div>
    );
  }

  if (dataSources.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('data_no_sources')}
        style={{ padding: '24px 16px' }}
      />
    );
  }

  return (
    <div className="data-workbench">
      <aside className="data-workbench-sidebar">
        <div className="data-workbench-source">
          <Text className="data-workbench-kicker">{t('data_workspace')}</Text>
          <Select
            size="small"
            value={activeSourceId ?? undefined}
            onChange={(id) => {
              setActiveSourceId(id);
              setActiveTableId(null);
              setSelectedColumnName(null);
            }}
            options={dataSources.map((source) => ({ value: source.id, label: source.name }))}
            style={{ width: '100%' }}
          />
        </div>

        <div className="data-workbench-sidebar-section">
          <div className="data-workbench-sidebar-title">
            <TableOutlined />
            {t('data_tables')}
          </div>
          {schemaLoading ? (
            <div className="data-workbench-loading-row">{t('data_loading_schema')}</div>
          ) : error ? (
            <Alert
              type="warning"
              showIcon
              message={t('data_schema_unavailable')}
              description={error instanceof Error ? error.message : t('data_schema_load_failed')}
            />
          ) : tables.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('data_no_tables')} />
          ) : (
            <div className="data-workbench-table-list">
              {tables.map((table) => (
                <button
                  key={table.id}
                  className={`data-workbench-table-btn${activeTable?.id === table.id ? ' active' : ''}`}
                  onClick={() => {
                    setActiveTableId(table.id);
                    setSelectedColumnName(table.columns[0]?.name ?? null);
                  }}
                >
                  <TableOutlined />
                  <span>{table.id}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="data-workbench-main">
        <div className="data-workbench-toolbar">
          <div>
            <Text className="data-workbench-mode">{t('data_view')}</Text>
            <h2>{activeTable?.id || t('data_select_table')}</h2>
          </div>
          <div className="data-workbench-actions">
            <Button icon={<PlusOutlined />}>{t('data_new_table')}</Button>
            <Button icon={<AppstoreOutlined />}>{t('data_manage_columns')}</Button>
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={() => activeSourceId && qc.invalidateQueries({ queryKey: dataSourceKeys.schema(activeSourceId) })}
            >
              {t('data_refresh')}
            </Button>
          </div>
        </div>

        <div className="data-workbench-formula">
          <span>fx</span>
          <div>{selectedColumn ? `${selectedColumn.name} : ${normalizeType(selectedColumn.type)}` : t('data_select_column')}</div>
          <CheckOutlined />
        </div>

        <div className="data-workbench-grid">
          <div className="data-workbench-grid-head">
            <span>#</span>
            <span>{t('data_column')}</span>
            <span>{t('data_datatype')}</span>
            <span>{t('data_role')}</span>
            <span>{t('data_nullable')}</span>
          </div>
          {activeTable?.columns.map((column, index) => (
            <button
              key={column.name}
              className={`data-workbench-grid-row${selectedColumn?.name === column.name ? ' active' : ''}`}
              onClick={() => setSelectedColumnName(column.name)}
              draggable={Boolean(activeSourceId && activeTable)}
              onDragStart={(event) => {
                if (!activeSourceId || !activeTable) return;
                setSelectedColumnName(column.name);
                setDashboardFieldDragData(event.dataTransfer, {
                  dataSourceId: activeSourceId,
                  tableName: activeTable.name,
                  tableId: activeTable.id,
                  columnName: column.name,
                  columnType: column.type,
                  label: `${activeTable.id}.${column.name}`,
                });
              }}
              title={t('data_drag_field_hint')}
            >
              <span>{index + 1}</span>
              <strong>{column.name}</strong>
              <span>{normalizeType(column.type)}</span>
              <span>
                {column.primary_key ? (
                  <Tag color="blue">{t('data_primary_key')}</Tag>
                ) : column.foreign_key ? (
                  <Tag color="cyan">{t('data_foreign_key')}</Tag>
                ) : (
                  <Tag>{t('data_field')}</Tag>
                )}
              </span>
              <span>{column.nullable === false ? t('data_no') : t('data_yes')}</span>
            </button>
          ))}
        </div>
      </main>

      <aside className="data-workbench-properties">
        <div className="data-workbench-properties-title">{t('data_field_properties')}</div>
        {selectedColumn ? (
          <>
            <Text className="data-workbench-kicker">{t('data_selected_column')}</Text>
            <div className="data-workbench-selected-field">
              <FieldStringOutlined />
              <span>{selectedColumn.name}</span>
            </div>
            <Text className="data-workbench-kicker">{t('data_datatype')}</Text>
            <Select
              value={normalizeType(selectedColumn.type)}
              options={[
                { value: 'Text', label: 'Text' },
                { value: 'Number', label: 'Number' },
                { value: 'Decimal', label: 'Decimal' },
                { value: 'Date', label: 'Date' },
                { value: 'Boolean', label: 'Boolean' },
              ]}
              style={{ width: '100%' }}
            />
            <Text className="data-workbench-kicker">{t('data_source')}</Text>
            <div className="data-workbench-source-note">
              <DatabaseOutlined />
              <span>{activeSourceId ? dataSources.find((source) => source.id === activeSourceId)?.name : t('data_source')}</span>
            </div>
          </>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('data_select_column')} />
        )}
      </aside>
    </div>
  );
}
