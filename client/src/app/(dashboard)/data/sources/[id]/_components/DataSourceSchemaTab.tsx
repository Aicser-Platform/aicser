'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Input, message, Table, Tag, Typography } from 'antd';
import { CheckOutlined, EyeInvisibleOutlined, EyeOutlined, SearchOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useDataSource, useDataSourceSchema, dataSourceKeys } from '@/hooks/useDataSources';
import { updateDataSourceBusinessMetadata } from '@/api/dataSources';
import { enhancedDataService } from '@/services/enhancedDataService';
import {
  normalizeType,
  friendlyName,
  fieldKey,
  getBusinessMetadata,
  inferSemanticRole,
  roleColor,
  roleLabelKey,
  normalizeSchemaTables,
  type SchemaFieldColumn,
  type SchemaFieldTable,
} from '@/utils/schemaFieldHelpers';

const { Text } = Typography;

type PreviewState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  rows?: Record<string, unknown>[];
  columns?: string[];
  error?: string;
};

/** Quote a SQL identifier only when it needs it (spaces, hyphens, leading digit, etc). */
function quoteIdentifier(id: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id) ? id : `"${id}"`;
}

/** Build a `SELECT * FROM <table> LIMIT n`-safe table reference for a preview query. */
function buildTableRef(table: SchemaFieldTable, dataSourceType?: string | null): string {
  const isFile = dataSourceType === 'file';
  const tableName = isFile ? 'data' : table.name;
  if (isFile || !table.schema || table.schema === 'public' || table.schema === 'file') {
    return quoteIdentifier(tableName);
  }
  return `${quoteIdentifier(table.schema)}.${quoteIdentifier(tableName)}`;
}

const PREVIEW_ROW_LIMIT = 20;

export const DataSourceSchemaTab: React.FC<{ dataSourceId: string }> = ({ dataSourceId }) => {
  const t = useTranslations('data_source_detail');
  const td = useTranslations('dashboards_page');
  const { dataSource } = useDataSource(dataSourceId);
  const { schema, isLoading } = useDataSourceSchema(dataSourceId);
  const businessMetadata = useMemo(() => getBusinessMetadata(schema), [schema]);
  const tables = useMemo(() => normalizeSchemaTables(schema), [schema]);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expandedTableId, setExpandedTableId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  // Column-description editing: draft text per fieldKey while the user is
  // typing (only committed on blur/Enter), and which key is mid-save.
  const [descDrafts, setDescDrafts] = useState<Record<string, string>>({});
  const [savingDescKey, setSavingDescKey] = useState<string | null>(null);

  const saveColumnDescription = async (key: string, value: string) => {
    const trimmed = value.trim();
    // No-op if unchanged from the persisted value - avoids a save round-trip
    // (and possibly clobbering a concurrent edit elsewhere) on a blur that
    // didn't actually change anything.
    const current = businessMetadata.column_descriptions?.[key] || '';
    if (trimmed === current) {
      setDescDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setSavingDescKey(key);
    try {
      // The backend replaces the WHOLE column_descriptions map on this key,
      // not a per-entry patch (see updateDataSourceBusinessMetadata's own
      // comment) - so every other column's existing description has to be
      // sent along, not just the one being edited.
      const merged = { ...(businessMetadata.column_descriptions || {}), [key]: trimmed };
      await updateDataSourceBusinessMetadata(dataSourceId, { column_descriptions: merged });
      await queryClient.invalidateQueries({ queryKey: dataSourceKeys.schema(dataSourceId) });
      setDescDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('description_save_failed'));
    } finally {
      setSavingDescKey(null);
    }
  };

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const visibleTables = useMemo(() => {
    if (!debouncedSearch) return tables;
    return tables.filter((table) => {
      const haystack = `${table.id} ${table.name} ${friendlyName(table.name)}`.toLowerCase();
      return haystack.includes(debouncedSearch);
    });
  }, [tables, debouncedSearch]);

  const runPreview = async (table: SchemaFieldTable) => {
    setPreviews((prev) => ({ ...prev, [table.id]: { status: 'loading' } }));
    try {
      const ref = buildTableRef(table, dataSource?.type);
      const sql = `SELECT * FROM ${ref} LIMIT ${PREVIEW_ROW_LIMIT}`;
      const result = await enhancedDataService.executeMultiEngineQuery(sql, dataSourceId);
      if (!result.success) {
        setPreviews((prev) => ({
          ...prev,
          [table.id]: { status: 'error', error: result.error || t('preview_data_error') },
        }));
        return;
      }
      const rows = Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
      const columns =
        Array.isArray(result.columns) && result.columns.length > 0
          ? result.columns
          : Object.keys(rows[0] || {});
      setPreviews((prev) => ({ ...prev, [table.id]: { status: 'success', rows, columns } }));
    } catch (err) {
      setPreviews((prev) => ({
        ...prev,
        [table.id]: { status: 'error', error: err instanceof Error ? err.message : t('preview_data_error') },
      }));
    }
  };

  const togglePreview = (table: SchemaFieldTable) => {
    if (expandedTableId === table.id) {
      setExpandedTableId(null);
      return;
    }
    setExpandedTableId(table.id);
    const existing = previews[table.id];
    if (!existing || existing.status === 'error') {
      void runPreview(table);
    }
  };

  if (!isLoading && tables.length === 0) {
    return <Empty description={t('schema_unavailable')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <>
      {tables.length > 0 ? (
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t('schema_search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 16, maxWidth: 360 }}
        />
      ) : null}

      {!isLoading && tables.length > 0 && visibleTables.length === 0 ? (
        <Empty description={t('schema_no_match')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : null}

      {visibleTables.map((table) => {
        const preview = previews[table.id];
        const isExpanded = expandedTableId === table.id;
        return (
          <Card
            key={table.id}
            title={table.id}
            size="small"
            style={{ marginBottom: 16 }}
            loading={isLoading}
            extra={
              <Button
                size="small"
                icon={isExpanded ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                onClick={() => togglePreview(table)}
              >
                {isExpanded ? t('preview_data_hide_action') : t('preview_data_action')}
              </Button>
            }
          >
            <Table<SchemaFieldColumn>
              rowKey="name"
              size="small"
              pagination={false}
              dataSource={table.columns}
              columns={[
                {
                  title: t('schema_column_name'),
                  dataIndex: 'name',
                  key: 'name',
                  render: (value: string) => (
                    <>
                      <div style={{ fontWeight: 500 }}>{friendlyName(value)}</div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {value}
                      </Text>
                    </>
                  ),
                },
                {
                  title: t('schema_column_role'),
                  key: 'role',
                  render: (_: unknown, column: SchemaFieldColumn) => {
                    const role = inferSemanticRole(column, businessMetadata);
                    return <Tag color={roleColor(role)}>{td(roleLabelKey(role))}</Tag>;
                  },
                },
                {
                  // Business-metadata authoring: the AI already reads
                  // column_descriptions into its NL2SQL prompts
                  // (schema_for_llm.py) and the Studio Data tab already
                  // displays them read-only - this PATCH endpoint
                  // (business-metadata) existed and worked, but nothing in
                  // the product could actually write to it, so in practice
                  // only a heuristic auto-generator or a dbt/Cube import
                  // ever populated it. Inline-editable here, next to the
                  // raw column list, mirrors how dbt/Looker treat column
                  // descriptions as part of browsing the schema, not a
                  // separate authoring flow.
                  title: t('schema_column_description'),
                  key: 'description',
                  width: 280,
                  render: (_: unknown, column: SchemaFieldColumn) => {
                    const key = fieldKey(table, column);
                    const persisted = businessMetadata.column_descriptions?.[key] || '';
                    const value = key in descDrafts ? descDrafts[key] : persisted;
                    const isSaving = savingDescKey === key;
                    return (
                      <Input
                        size="small"
                        value={value}
                        placeholder={t('schema_column_description_placeholder')}
                        disabled={isSaving}
                        suffix={isSaving ? <CheckOutlined spin /> : undefined}
                        onChange={(e) => setDescDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                        onBlur={(e) => void saveColumnDescription(key, e.target.value)}
                        onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                      />
                    );
                  },
                },
                {
                  title: t('schema_column_type'),
                  dataIndex: 'type',
                  key: 'type',
                  render: (value: string) => (
                    <>
                      <Tag>{normalizeType(value)}</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {value}
                      </Text>
                    </>
                  ),
                },
                {
                  title: t('schema_column_nullable'),
                  dataIndex: 'nullable',
                  key: 'nullable',
                  render: (value?: boolean) => <Text type="secondary">{value === false ? 'NOT NULL' : '—'}</Text>,
                },
              ]}
            />

            {isExpanded ? (
              <div style={{ marginTop: 12 }}>
                {!preview || preview.status === 'loading' ? (
                  <div style={{ padding: 16, textAlign: 'center' }}>
                    <Text type="secondary">{t('preview_data_loading')}</Text>
                  </div>
                ) : preview.status === 'error' ? (
                  <Alert type="error" showIcon message={preview.error || t('preview_data_error')} />
                ) : preview.rows && preview.rows.length > 0 ? (
                  <div
                    className="aiser-themed-scrollbar"
                    style={{
                      maxHeight: 320,
                      overflow: 'auto',
                      border: '1px solid var(--ant-color-border)',
                      borderRadius: 4,
                      padding: 8,
                      background: 'var(--ant-color-bg-container)',
                    }}
                  >
                    <Table
                      size="small"
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                      dataSource={preview.rows.map((row, idx) => ({ ...row, __rowKey: idx }))}
                      rowKey="__rowKey"
                      columns={(preview.columns || []).map((col) => ({
                        title: col,
                        dataIndex: col,
                        key: col,
                        render: (value: unknown) =>
                          value === null || value === undefined ? (
                            <Text type="secondary">—</Text>
                          ) : (
                            String(value)
                          ),
                      }))}
                    />
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                      {t('preview_data_rows_shown', { rows: preview.rows.length })}
                    </Text>
                  </div>
                ) : (
                  <Empty description={t('preview_data_empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </div>
            ) : null}
          </Card>
        );
      })}
    </>
  );
};

export default DataSourceSchemaTab;
