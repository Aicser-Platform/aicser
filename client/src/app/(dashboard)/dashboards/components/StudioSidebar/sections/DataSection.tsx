'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Empty, Input, Select, Spin, Tag, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import {
  CheckOutlined,
  DatabaseOutlined,
  FieldStringOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useDataSources, useDataSourceSchema, dataSourceKeys } from '@/hooks/useDataSources';
import { setDashboardFieldDragData } from '../../../utils/dashboardFieldDrag';

const { Text } = Typography;

type SemanticRole = 'dimension' | 'measure' | 'date' | 'id';

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

type BusinessMetadata = {
  measures?: Array<{ name?: string; expression?: string; description?: string }>;
  dimensions?: Array<{ name?: string; description?: string }>;
  column_descriptions?: Record<string, string>;
};

function normalizeType(type: string): string {
  const upper = type.toUpperCase();
  if (upper.includes('INT')) return 'Number';
  if (upper.includes('DECIMAL') || upper.includes('NUMERIC') || upper.includes('DOUBLE') || upper.includes('FLOAT')) return 'Decimal';
  if (upper.includes('DATE') || upper.includes('TIME')) return 'Date';
  if (upper.includes('BOOL')) return 'Boolean';
  return 'Text';
}

function friendlyName(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function fieldKey(table: DisplayTable | null, column: DisplayColumn | null): string {
  if (!table || !column) return '';
  return `${table.id}.${column.name}`;
}

function hiddenPrefsKey(sourceId: string | null): string {
  return `dashboard_data_hidden_fields_${sourceId || 'none'}`;
}

function getBusinessMetadata(schema: unknown): BusinessMetadata {
  const raw = ((schema as { business_metadata?: BusinessMetadata } | null)?.business_metadata ?? {}) as BusinessMetadata;
  return {
    measures: Array.isArray(raw.measures) ? raw.measures : [],
    dimensions: Array.isArray(raw.dimensions) ? raw.dimensions : [],
    column_descriptions: raw.column_descriptions && typeof raw.column_descriptions === 'object' ? raw.column_descriptions : {},
  };
}

function inferSemanticRole(column: DisplayColumn, metadata: BusinessMetadata): SemanticRole {
  const name = column.name.toLowerCase();
  const normalizedType = normalizeType(column.type);
  const isMeasure = metadata.measures?.some((m) => m.name === column.name || m.expression === column.name);
  const isDimension = metadata.dimensions?.some((d) => d.name === column.name);
  if (isMeasure) return 'measure';
  if (isDimension) return 'dimension';
  if (column.primary_key || /(^id$|_id$|id$|key$|uuid$)/.test(name)) return 'id';
  if (normalizedType === 'Date' || /(date|time|month|year|quarter|week|day)/.test(name)) return 'date';
  if (normalizedType === 'Number' || normalizedType === 'Decimal') return 'measure';
  return 'dimension';
}

function defaultAggregation(column: DisplayColumn, role: SemanticRole): string {
  const name = column.name.toLowerCase();
  if (role === 'measure') {
    if (/(rate|ratio|percent|pct|margin|score|price|unit_price|avg|average)/.test(name)) return 'avg';
    if (/(min|max)/.test(name)) return name.includes('min') ? 'min' : 'max';
    return 'sum';
  }
  if (role === 'id') return 'count distinct';
  return 'count';
}

function roleColor(role: SemanticRole): string {
  if (role === 'measure') return 'green';
  if (role === 'date') return 'blue';
  if (role === 'id') return 'purple';
  return 'cyan';
}

function roleLabelKey(role: SemanticRole): 'data_role_dimension' | 'data_role_measure' | 'data_role_date' | 'data_role_id' {
  if (role === 'measure') return 'data_role_measure';
  if (role === 'date') return 'data_role_date';
  if (role === 'id') return 'data_role_id';
  return 'data_role_dimension';
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
  const [fieldSearch, setFieldSearch] = useState('');
  const [showHiddenFields, setShowHiddenFields] = useState(false);
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!activeSourceId && dataSources[0]?.id) {
      setActiveSourceId(dataSources[0].id);
    }
  }, [activeSourceId, dataSources]);

  const { schema, isLoading: schemaLoading, error } = useDataSourceSchema(activeSourceId);
  const tables = useMemo(() => normalizeTables(schema), [schema]);
  const businessMetadata = useMemo(() => getBusinessMetadata(schema), [schema]);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(hiddenPrefsKey(activeSourceId));
      setHiddenFields(new Set(raw ? JSON.parse(raw) : []));
    } catch {
      setHiddenFields(new Set());
    }
  }, [activeSourceId]);

  const updateHiddenFields = (next: Set<string>) => {
    setHiddenFields(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(hiddenPrefsKey(activeSourceId), JSON.stringify(Array.from(next)));
    } catch {
      // ignore local preference persistence failures
    }
  };

  const selectedColumnRole = selectedColumn ? inferSemanticRole(selectedColumn, businessMetadata) : null;
  const selectedColumnDescription = selectedColumn
    ? businessMetadata.column_descriptions?.[fieldKey(activeTable, selectedColumn)] ||
      businessMetadata.column_descriptions?.[selectedColumn.name] ||
      businessMetadata.measures?.find((m) => m.name === selectedColumn.name || m.expression === selectedColumn.name)?.description ||
      businessMetadata.dimensions?.find((d) => d.name === selectedColumn.name)?.description ||
      null
    : null;
  const normalizedFieldSearch = fieldSearch.trim().toLowerCase();
  const visibleColumns = useMemo(() => {
    if (!activeTable) return [];
    return activeTable.columns.filter((column) => {
      const key = fieldKey(activeTable, column);
      const role = inferSemanticRole(column, businessMetadata);
      const description =
        businessMetadata.column_descriptions?.[key] ||
        businessMetadata.column_descriptions?.[column.name] ||
        '';
      const matchesSearch =
        !normalizedFieldSearch ||
        column.name.toLowerCase().includes(normalizedFieldSearch) ||
        friendlyName(column.name).toLowerCase().includes(normalizedFieldSearch) ||
        normalizeType(column.type).toLowerCase().includes(normalizedFieldSearch) ||
        role.toLowerCase().includes(normalizedFieldSearch) ||
        description.toLowerCase().includes(normalizedFieldSearch);
      return matchesSearch && (showHiddenFields || !hiddenFields.has(key));
    });
  }, [activeTable, businessMetadata, hiddenFields, normalizedFieldSearch, showHiddenFields]);

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
            {activeTable ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <Tag>{t('data_columns_count', { count: activeTable.columns.length })}</Tag>
                {activeTable.rowCount !== null && activeTable.rowCount !== undefined ? (
                  <Tag>{t('data_rows_count', { count: activeTable.rowCount })}</Tag>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="data-workbench-actions">
            {activeSourceId ? (
              <Button href={`/data/sources/${activeSourceId}/semantic`}>
                {t('data_open_semantic_model')}
              </Button>
            ) : null}
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
          <div>
            {selectedColumn
              ? `${friendlyName(selectedColumn.name)} : ${selectedColumnRole ? t(roleLabelKey(selectedColumnRole)) : normalizeType(selectedColumn.type)}`
              : t('data_select_column')}
          </div>
          <CheckOutlined />
        </div>

        <div className="data-workbench-field-tools">
          <Input
            size="small"
            prefix={<SearchOutlined />}
            allowClear
            value={fieldSearch}
            onChange={(event) => setFieldSearch(event.target.value)}
            placeholder={t('data_search_fields')}
          />
          <Button size="small" onClick={() => setShowHiddenFields((value) => !value)}>
            {showHiddenFields ? t('data_hide_hidden_fields') : t('data_show_hidden_fields')}
          </Button>
        </div>

        <div className="data-workbench-grid">
          <div className="data-workbench-grid-head">
            <span>#</span>
            <span>{t('data_column')}</span>
            <span>{t('data_role')}</span>
            <span>{t('data_datatype')}</span>
            <span>{t('data_default_aggregation')}</span>
            <span>{t('data_visibility')}</span>
          </div>
          {visibleColumns.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('data_no_matching_fields')} style={{ padding: 24 }} />
          ) : (
            visibleColumns.map((column, index) => {
              const role = inferSemanticRole(column, businessMetadata);
              const key = fieldKey(activeTable, column);
              const isHidden = hiddenFields.has(key);
              return (
                <button
                  key={column.name}
                  className={`data-workbench-grid-row${selectedColumn?.name === column.name ? ' active' : ''}${isHidden ? ' muted' : ''}`}
                  onClick={() => setSelectedColumnName(column.name)}
                  draggable={Boolean(activeSourceId && activeTable && !isHidden)}
                  onDragStart={(event) => {
                    if (!activeSourceId || !activeTable || isHidden) return;
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
                  <strong>{friendlyName(column.name)}</strong>
                  <span>
                    <Tag color={roleColor(role)}>{t(roleLabelKey(role))}</Tag>
                  </span>
                  <span>{normalizeType(column.type)}</span>
                  <span>{defaultAggregation(column, role)}</span>
                  <span>
                    <Button
                      size="small"
                      type="text"
                      onClick={(event) => {
                        event.stopPropagation();
                        const next = new Set(hiddenFields);
                        if (isHidden) next.delete(key);
                        else next.add(key);
                        updateHiddenFields(next);
                      }}
                    >
                      {isHidden ? t('data_show_field') : t('data_hide_field')}
                    </Button>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </main>

      <aside className="data-workbench-properties">
        <div className="data-workbench-properties-title">{t('data_field_properties')}</div>
        {selectedColumn ? (
          <>
            <Text className="data-workbench-kicker">{t('data_selected_column')}</Text>
            <div className="data-workbench-selected-field">
              <FieldStringOutlined />
              <span>{friendlyName(selectedColumn.name)}</span>
            </div>
            <Text className="data-workbench-kicker">{t('data_physical_column')}</Text>
            <div className="data-workbench-source-note">
              <DatabaseOutlined />
              <span>{selectedColumn.name}</span>
            </div>
            <Text className="data-workbench-kicker">{t('data_datatype')}</Text>
            <div className="data-workbench-source-note">
              <FieldStringOutlined />
              <span>{normalizeType(selectedColumn.type)}</span>
            </div>
            <Text className="data-workbench-kicker">{t('data_role')}</Text>
            <div className="data-workbench-source-note">
              <TableOutlined />
              <span>{selectedColumnRole ? t(roleLabelKey(selectedColumnRole)) : t('data_field')}</span>
            </div>
            <Text className="data-workbench-kicker">{t('data_default_aggregation')}</Text>
            <div className="data-workbench-source-note">
              <CheckOutlined />
              <span>{selectedColumnRole ? defaultAggregation(selectedColumn, selectedColumnRole) : t('data_none')}</span>
            </div>
            <Text className="data-workbench-kicker">{t('data_nullable')}</Text>
            <div className="data-workbench-source-note">
              <CheckOutlined />
              <span>{selectedColumn.nullable === false ? t('data_no') : t('data_yes')}</span>
            </div>
            {selectedColumnDescription ? (
              <>
                <Text className="data-workbench-kicker">{t('data_description')}</Text>
                <div className="data-workbench-source-note data-workbench-source-note-wrap">
                  <span>{selectedColumnDescription}</span>
                </div>
              </>
            ) : null}
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
