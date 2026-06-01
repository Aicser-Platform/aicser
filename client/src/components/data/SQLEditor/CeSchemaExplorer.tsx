'use client';

/**
 * CeSchemaExplorer — CE-edition schema sidebar for the SQL query editor.
 * Provides data source selection, table/column tree, and click-to-insert.
 * EE users get the richer EnhancedDataPanel; this component serves CE.
 */

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Select, Spin, Tag, Tabs, Tooltip, Typography, message } from 'antd';
import {
  CaretRightOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EyeOutlined,
  FunctionOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
  CloudServerOutlined,
} from '@ant-design/icons';
import { formatUserError } from '@/utils/formatUserError';
import { useTranslations } from 'next-intl';
import { useDataSourceSchema, useDataSources } from '@/hooks/useDataSources';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { useQueryClient } from '@tanstack/react-query';
import { dataSourceKeys } from '@/hooks/dataSourceKeys';
import { fetchApi } from '@/utils/api';

const { Text } = Typography;
const { TabPane } = Tabs;

// Brief type badge colour per SQL type family
const TYPE_COLOR: Record<string, string> = {
  int: 'blue', integer: 'blue', bigint: 'blue', smallint: 'blue', tinyint: 'blue',
  numeric: 'blue', decimal: 'blue', float: 'blue', double: 'blue', real: 'blue', number: 'blue',
  varchar: 'green', char: 'green', text: 'green', string: 'green', nvarchar: 'green',
  date: 'orange', datetime: 'orange', timestamp: 'orange', time: 'orange',
  bool: 'purple', boolean: 'purple',
};

function typeColor(type: string): string {
  const lower = (type || '').toLowerCase();
  for (const [key, color] of Object.entries(TYPE_COLOR)) {
    if (lower.includes(key)) return color;
  }
  return 'default';
}

function abbreviateType(type: string): string {
  const t = (type || '').toLowerCase();
  if (t.includes('varchar') || t.includes('character varying')) return 'varchar';
  if (t.includes('timestamp') || t.includes('datetime')) return 'ts';
  if (t.includes('boolean') || t.includes('bool')) return 'bool';
  if (t.includes('integer') || t.includes('bigint') || t.includes('int')) return 'int';
  if (t.includes('float') || t.includes('double') || t.includes('real') || t.includes('numeric')) return 'num';
  if (t.includes('date')) return 'date';
  if (t.includes('text') || t.includes('string')) return 'text';
  return type.slice(0, 6);
}

interface DDLObject {
  schema: string;
  name: string;
  columns?: { name: string; type: string }[];
}

interface CalcField {
  id: string;
  name: string;
  expression: string;
  description?: string;
}

interface CeSchemaExplorerProps {
  onCollapse?: () => void;
  onTableClick?: (tableName: string, schemaName: string) => void;
  onColumnClick?: (tableName: string, columnName: string, schemaName: string) => void;
}

export const CeSchemaExplorer: React.FC<CeSchemaExplorerProps> = ({
  onCollapse,
  onTableClick,
  onColumnClick,
}) => {
  const t = useTranslations('schema_explorer');
  const { selectedId, select } = useDataSourceStore();
  const { dataSources, isLoading: dsLoading } = useDataSources();
  const { schema, isLoading: schemaLoading } = useDataSourceSchema(selectedId ?? null);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const autoExpandedTableRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<'tables' | 'views' | 'matviews' | 'calc'>('tables');

  // Views
  const [views, setViews] = useState<DDLObject[]>([]);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [viewsLoaded, setViewsLoaded] = useState<string | null>(null); // dsId when last loaded

  // Materialized Views
  const [matViews, setMatViews] = useState<DDLObject[]>([]);
  const [matViewsLoading, setMatViewsLoading] = useState(false);
  const [matViewsLoaded, setMatViewsLoaded] = useState<string | null>(null);

  // Calculated Fields
  const [calcFields, setCalcFields] = useState<CalcField[]>([]);
  const [calcFieldsLoading, setCalcFieldsLoading] = useState(false);
  const [calcFieldsLoaded, setCalcFieldsLoaded] = useState<string | null>(null);
  const [addCalcOpen, setAddCalcOpen] = useState(false);
  const [addCalcSaving, setAddCalcSaving] = useState(false);
  const [calcForm] = Form.useForm();

  const tables = useMemo(() => {
    const all = schema?.tables ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (t: any) => t.name.toLowerCase().includes(q) || t.columns?.some((c: any) => c.name.toLowerCase().includes(q))
    );
  }, [schema, search]);

  // Expand the first table by default when schema loads (skip while searching).
  useEffect(() => {
    if (search.trim() || !selectedId || tables.length === 0) return;
    const marker = `${selectedId}:${tables.length}:${tables[0]?.name ?? ''}`;
    if (autoExpandedTableRef.current === marker) return;
    const first = tables[0] as { name: string; schema?: string };
    const tKey = first.schema ? `${first.schema}.${first.name}` : first.name;
    autoExpandedTableRef.current = marker;
    setExpandedTables(new Set([tKey]));
  }, [tables, selectedId, search]);

  const filteredViews = useMemo(() => {
    if (!search.trim()) return views;
    const q = search.toLowerCase();
    return views.filter(v => v.name.toLowerCase().includes(q) || v.schema?.toLowerCase().includes(q));
  }, [views, search]);

  const filteredMatViews = useMemo(() => {
    if (!search.trim()) return matViews;
    const q = search.toLowerCase();
    return matViews.filter(v => v.name.toLowerCase().includes(q) || v.schema?.toLowerCase().includes(q));
  }, [matViews, search]);

  const dsOptions = useMemo(
    () => dataSources.map((ds: any) => ({ label: ds.name, value: ds.id })),
    [dataSources]
  );

  const toggleTable = (name: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleRefresh = () => {
    if (selectedId) {
      qc.invalidateQueries({ queryKey: dataSourceKeys.schema(selectedId) });
      setViewsLoaded(null);
      setMatViewsLoaded(null);
      setCalcFieldsLoaded(null);
    }
  };

  const loadViews = useCallback(async (dsId: string) => {
    if (viewsLoaded === dsId) return;
    setViewsLoading(true);
    try {
      const res = await fetchApi(`/api/data/sources/${dsId}/views`);
      setViews(Array.isArray(res?.views) ? res.views : []);
      setViewsLoaded(dsId);
    } catch {
      setViews([]);
    } finally {
      setViewsLoading(false);
    }
  }, [viewsLoaded]);

  const loadMatViews = useCallback(async (dsId: string) => {
    if (matViewsLoaded === dsId) return;
    setMatViewsLoading(true);
    try {
      const res = await fetchApi(`/api/data/sources/${dsId}/materialized-views`);
      setMatViews(Array.isArray(res?.materialized_views) ? res.materialized_views : []);
      setMatViewsLoaded(dsId);
    } catch {
      setMatViews([]);
    } finally {
      setMatViewsLoading(false);
    }
  }, [matViewsLoaded]);

  const loadCalcFields = useCallback(async (dsId: string) => {
    if (calcFieldsLoaded === dsId) return;
    setCalcFieldsLoading(true);
    try {
      const res = await fetchApi(`/api/data/data-sources/${dsId}/model/calc-fields`);
      setCalcFields(Array.isArray(res?.calc_fields) ? res.calc_fields : []);
      setCalcFieldsLoaded(dsId);
    } catch {
      setCalcFields([]);
    } finally {
      setCalcFieldsLoading(false);
    }
  }, [calcFieldsLoaded]);

  const handleAddCalcField = async () => {
    const values = await calcForm.validateFields();
    if (!selectedId) return;
    setAddCalcSaving(true);
    try {
      await fetchApi(`/api/data/data-sources/${selectedId}/model/calc-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      message.success(t('calc_save_ok'));
      calcForm.resetFields();
      setAddCalcOpen(false);
      setCalcFieldsLoaded(null);
      await loadCalcFields(selectedId);
    } catch (e: any) {
      message.error(formatUserError(e, t('calc_save_failed')));
    } finally {
      setAddCalcSaving(false);
    }
  };

  const handleDeleteCalcField = async (field: CalcField) => {
    if (!selectedId) return;
    try {
      await fetchApi(`/api/data/data-sources/${selectedId}/model/calc-fields/${field.id}`, { method: 'DELETE' });
      setCalcFields((prev) => prev.filter((f) => f.id !== field.id));
      message.success(`Deleted "${field.name}"`);
    } catch {
      message.error(t('calc_delete_failed'));
    }
  };

  const handleTabChange = (key: string) => {
    setActiveTab(key as typeof activeTab);
    if (!selectedId) return;
    if (key === 'views') loadViews(selectedId);
    if (key === 'matviews') loadMatViews(selectedId);
    if (key === 'calc') loadCalcFields(selectedId);
  };

  const renderObjectRow = (obj: DDLObject, icon: React.ReactNode, insertPrefix: string) => {
    const key = `${obj.schema}.${obj.name}`;
    const isExpanded = expandedTables.has(key);
    const cols = obj.columns ?? [];

    return (
      <div key={key} style={{ borderBottom: '1px solid var(--ant-color-border-secondary)' }}>
        <div className="schema-explorer-object-row" onClick={() => toggleTable(key)}>
          {cols.length > 0 ? (
            <span className={`schema-explorer-caret-slot${isExpanded ? ' is-expanded' : ''}`} aria-hidden>
              <CaretRightOutlined />
            </span>
          ) : (
            <span className="schema-explorer-caret-slot" aria-hidden style={{ visibility: 'hidden' }} />
          )}
          {icon}
          <Text style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={key}>
            {obj.name}
          </Text>
          {obj.schema && (
            <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>{obj.schema}</Text>
          )}
          <Tooltip title={`${insertPrefix} ${key} LIMIT 100`} placement="left">
            <CopyOutlined
              style={{ fontSize: 11, color: 'var(--ant-color-text-description)', opacity: 0.7 }}
              onClick={(e) => {
                e.stopPropagation();
                onTableClick?.(obj.name, obj.schema ?? '');
              }}
            />
          </Tooltip>
        </div>
        {isExpanded && cols.length > 0 && (
          <div style={{ paddingLeft: 28, paddingBottom: 4 }}>
            {cols.map((col) => (
              <div
                key={col.name}
                className="schema-explorer-column-row"
                onClick={() => onColumnClick?.(obj.name, col.name, obj.schema ?? '')}
              >
                <Text style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {col.name}
                </Text>
                <Tag color={typeColor(col.type)} style={{ fontSize: 9, padding: '0 4px', lineHeight: '16px', height: 16, margin: 0 }}>
                  {abbreviateType(col.type)}
                </Tag>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="schema-explorer-panel data-panel-flat"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--ant-color-bg-container)' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 8px', borderBottom: '1px solid var(--ant-color-border-secondary)', flexShrink: 0 }}>
        <DatabaseOutlined style={{ color: 'var(--ant-color-primary)', fontSize: 14 }} />
        <Text strong style={{ fontSize: 13, flex: 1 }}>{t('title')}</Text>
        <Tooltip title={t('refresh_schema')}>
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={handleRefresh} loading={schemaLoading} style={{ padding: 2 }} aria-label={t('refresh_schema')} />
        </Tooltip>
        {onCollapse && (
          <Tooltip title={t('collapse_panel')}>
            <Button type="text" size="small" icon={<MinusOutlined />} onClick={onCollapse} style={{ padding: 2 }} aria-label={t('collapse_panel')} />
          </Tooltip>
        )}
      </div>

      {/* Data source selector */}
      <div style={{ padding: '8px 12px 4px', flexShrink: 0 }}>
        <Select
          size="small"
          style={{ width: '100%' }}
          loading={dsLoading}
          value={selectedId ?? undefined}
          onChange={(id) => {
            select(id);
            setViewsLoaded(null);
            setMatViewsLoaded(null);
          }}
          options={dsOptions}
          placeholder={t('select_data_source_placeholder')}
          showSearch
          optionFilterProp="label"
          notFoundContent={dsLoading ? <Spin size="small" /> : t('no_data_sources')}
        />
      </div>

      {/* Search */}
      {selectedId && (
        <div style={{ padding: '4px 12px 6px', flexShrink: 0 }}>
          <Input
            size="small"
            placeholder={t('search_placeholder')}
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
        </div>
      )}

      {/* Object type tabs */}
      {selectedId && (
        <Tabs
          size="small"
          activeKey={activeTab}
          onChange={handleTabChange}
          style={{ flexShrink: 0 }}
          tabBarStyle={{ margin: 0, padding: '0 8px' }}
          items={[
            { key: 'tables', label: <><TableOutlined /> {t('tab_tables')} ({(schema?.tables ?? []).length})</> },
            { key: 'views', label: <><EyeOutlined /> {t('tab_views')}</> },
            { key: 'matviews', label: <><CloudServerOutlined /> {t('tab_mat_views')}</> },
            { key: 'calc', label: <><FunctionOutlined style={{ color: 'var(--ant-color-warning)' }} /> {t('tab_calc')} ({calcFields.length})</> },
          ]}
        />
      )}

      {/* Schema tree */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 0 16px' }}>
        {!selectedId && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)', fontSize: 12 }}>
            {t('select_data_source_hint')}
          </div>
        )}

        {selectedId && activeTab === 'tables' && (
          <>
            {schemaLoading && (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <Spin size="small" tip={t('loading_schema')} />
              </div>
            )}
            {!schemaLoading && tables.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)', fontSize: 12 }}>
                {search ? t('no_matches') : t('no_tables')}
              </div>
            )}
            {!schemaLoading && tables.map((table: any) => {
              const tKey = table.schema ? `${table.schema}.${table.name}` : table.name;
              const isExpanded = expandedTables.has(tKey);
              const columns = table.columns ?? [];
              const filteredCols = search ? columns.filter((c: any) => c.name.toLowerCase().includes(search.toLowerCase())) : columns;

              return (
                <div key={tKey} style={{ borderBottom: '1px solid var(--ant-color-border-secondary)' }}>
                  <div className="schema-explorer-object-row" onClick={() => toggleTable(tKey)}>
                    <span className={`schema-explorer-caret-slot${isExpanded ? ' is-expanded' : ''}`} aria-hidden>
                      <CaretRightOutlined />
                    </span>
                    <TableOutlined style={{ color: 'var(--ant-color-primary)', fontSize: 12, flexShrink: 0 }} />
                    <Text style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tKey}>
                      {table.name}
                    </Text>
                    {table.schema && (
                      <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>{table.schema}</Text>
                    )}
                    <Tooltip title={`INSERT: SELECT * FROM ${tKey} LIMIT 100`} placement="left">
                      <CopyOutlined
                        style={{ fontSize: 11, color: 'var(--ant-color-text-description)', opacity: 0.7 }}
                        onClick={(e) => { e.stopPropagation(); onTableClick?.(table.name, table.schema ?? ''); }}
                      />
                    </Tooltip>
                  </div>
                  {isExpanded && (
                    <div style={{ paddingLeft: 28, paddingBottom: 4 }}>
                      {filteredCols.length === 0 && (
                        <Text type="secondary" style={{ fontSize: 11, padding: '2px 12px', display: 'block' }}>No columns</Text>
                      )}
                      {filteredCols.map((col: any) => (
                        <div
                          key={col.name}
                          className="schema-explorer-column-row"
                          onClick={() => onColumnClick?.(table.name, col.name, table.schema ?? '')}
                          title={`Click to insert column: ${col.name}`}
                        >
                          <Text style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ant-color-text)' }}>
                            {col.name}
                          </Text>
                          <Tag color={typeColor(col.type)} style={{ fontSize: 9, padding: '0 4px', lineHeight: '16px', height: 16, margin: 0, flexShrink: 0 }}>
                            {abbreviateType(col.type)}
                          </Tag>
                          {col.primary_key && (
                            <Tag color="gold" style={{ fontSize: 9, padding: '0 3px', lineHeight: '16px', height: 16, margin: 0 }}>PK</Tag>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {selectedId && activeTab === 'views' && (
          <>
            {viewsLoading && <div style={{ padding: 24, textAlign: 'center' }}><Spin size="small" tip={t('loading_views')} /></div>}
            {!viewsLoading && filteredViews.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)', fontSize: 12 }}>
                {viewsLoaded === selectedId
                  ? (search ? t('no_matches') : t('no_views'))
                  : t('views_not_loaded')}
              </div>
            )}
            {!viewsLoading && filteredViews.map((v) =>
              renderObjectRow(v, <EyeOutlined style={{ color: 'var(--ant-color-success)', fontSize: 12, flexShrink: 0 }} />, 'SELECT * FROM')
            )}
          </>
        )}

        {selectedId && activeTab === 'matviews' && (
          <>
            {matViewsLoading && <div style={{ padding: 24, textAlign: 'center' }}><Spin size="small" tip={t('loading_mat_views')} /></div>}
            {!matViewsLoading && filteredMatViews.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)', fontSize: 12 }}>
                {matViewsLoaded === selectedId
                  ? (search ? t('no_matches') : t('no_mat_views'))
                  : t('mat_views_not_loaded')}
              </div>
            )}
            {!matViewsLoading && filteredMatViews.map((v) =>
              renderObjectRow(v, <CloudServerOutlined style={{ color: 'var(--ant-color-warning)', fontSize: 12, flexShrink: 0 }} />, 'SELECT * FROM')
            )}
          </>
        )}

        {/* ── Calculated Fields Tab ──────────────────────────────────── */}
        {selectedId && activeTab === 'calc' && (
          <>
            <div style={{ padding: '8px 12px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Text type="secondary" style={{ fontSize: 11, flex: 1 }}>
                Expressions inserted as-is into SQL. Available as AI metrics.
              </Text>
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => { calcForm.resetFields(); setAddCalcOpen(true); }}
              >
                Add
              </Button>
            </div>
            {calcFieldsLoading && <div style={{ padding: 24, textAlign: 'center' }}><Spin size="small" /></div>}
            {!calcFieldsLoading && calcFields.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--ant-color-text-secondary)', fontSize: 12 }}>
                No calculated fields yet. Click Add to define one.
              </div>
            )}
            {!calcFieldsLoading && calcFields.map((field) => (
              <div
                key={field.id}
                style={{ borderBottom: '1px solid var(--ant-color-border-secondary)', padding: '6px 12px', display: 'flex', alignItems: 'flex-start', gap: 6 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ant-color-fill-quaternary)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <FunctionOutlined style={{ color: 'var(--ant-color-warning)', fontSize: 12, marginTop: 2, flexShrink: 0 }} />
                <div
                  style={{ flex: 1, cursor: 'pointer', minWidth: 0 }}
                  onClick={() => onColumnClick?.('', field.expression, '')}
                  title={`Click to insert: ${field.expression}`}
                >
                  <Text strong style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {field.name}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 10, fontFamily: 'monospace', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {field.expression}
                  </Text>
                </div>
                <Popconfirm
                  title={`Delete "${field.name}"?`}
                  onConfirm={() => handleDeleteCalcField(field)}
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ flexShrink: 0, opacity: 0.5 }} />
                </Popconfirm>
              </div>
            ))}
          </>
        )}
      </div>{/* end schema tree scroll container */}

      {/* Footer hint */}
      {selectedId && (
        <div style={{ padding: '6px 12px', borderTop: '1px solid var(--ant-color-border-secondary)', flexShrink: 0 }}>
          <Text type="secondary" style={{ fontSize: 10 }}>
            {t('calc_footer_hint')}
          </Text>
        </div>
      )}

      {/* Add Calculated Field Modal */}
      <Modal
        title={<><FunctionOutlined style={{ color: 'var(--ant-color-warning)' }} /> {t('calc_modal_title')}</>}
        open={addCalcOpen}
        onCancel={() => { setAddCalcOpen(false); calcForm.resetFields(); }}
        onOk={handleAddCalcField}
        confirmLoading={addCalcSaving}
        okText={t('calc_modal_save')}
        destroyOnHidden
        width={460}
      >
        <Form form={calcForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="name"
            label={t('calc_field_name')}
            rules={[
              { required: true, message: t('calc_field_name_required') },
              { pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/, message: t('calc_field_name_pattern') },
            ]}
          >
            <Input placeholder="profit_margin" />
          </Form.Item>
          <Form.Item
            name="expression"
            label={t('calc_expression')}
            tooltip={t('calc_expression_tooltip')}
            rules={[{ required: true, message: t('calc_expression_required') }]}
          >
            <Input.TextArea
              rows={3}
              placeholder="(revenue - cost) / NULLIF(revenue, 0) * 100"
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>
          <Form.Item name="description" label={t('calc_description')}>
            <Input placeholder={t('calc_description_placeholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CeSchemaExplorer;
