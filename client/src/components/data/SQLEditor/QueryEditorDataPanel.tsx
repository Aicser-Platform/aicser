'use client';

import React, { useCallback, useEffect, useMemo } from 'react';
import { Button, Empty, Select, Space, Spin, Tag, Tooltip, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  CompressOutlined,
  DatabaseOutlined,
  PlusOutlined,
  ReloadOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { DataSourceIcon } from '@/utils/dataSourceIcons';
import {
  type DataSource,
  type SchemaInfo,
  useDataSources,
} from '@/stores/useDataSourceStore';

const { Text } = Typography;

interface QueryEditorDataPanelProps {
  onCollapse?: () => void;
  onTableClick?: (tableName: string, schemaName: string) => void;
  onColumnClick?: (tableName: string, columnName: string, schemaName: string) => void;
  compact?: boolean;
}

function getDataSourceStatus(ds: DataSource): string {
  if (ds.connection_status === 'connected') return 'connected';
  if (ds.connection_status === 'failed') return 'failed';
  return ds.connection_status || 'unknown';
}

function getSchemaName(schemaName?: string): string {
  return schemaName || 'public';
}

function buildTreeData(
  schema: SchemaInfo | null | undefined,
  onTableClick?: (tableName: string, schemaName: string) => void,
  onColumnClick?: (tableName: string, columnName: string, schemaName: string) => void
): DataNode[] {
  if (!schema) return [];

  const tableNodes: DataNode[] = (schema.tables || []).map((table) => {
    const schemaName = getSchemaName(table.schema);

    return {
      key: `table:${schemaName}.${table.name}`,
      title: (
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}
          onClick={(event) => {
            event.stopPropagation();
            onTableClick?.(table.name, schemaName);
          }}
        >
          <TableOutlined style={{ color: 'var(--ant-color-primary)' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {schemaName !== 'public' ? `${schemaName}.${table.name}` : table.name}
          </span>
          {typeof table.rowCount === 'number' ? (
            <Tag style={{ marginInlineEnd: 0 }}>{table.rowCount.toLocaleString()}</Tag>
          ) : null}
        </span>
      ),
      children: table.columns.map((column) => ({
        key: `column:${schemaName}.${table.name}.${column.name}`,
        title: (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}
            onClick={(event) => {
              event.stopPropagation();
              onColumnClick?.(table.name, column.name, schemaName);
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {column.name}
            </span>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {column.type}
            </Text>
          </span>
        ),
        isLeaf: true,
      })),
    };
  });

  const viewNodes: DataNode[] = (schema.views || []).map((view) => {
    const schemaName = getSchemaName(view.schema);

    return {
      key: `view:${schemaName}.${view.name}`,
      title: (
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}
          onClick={(event) => {
            event.stopPropagation();
            onTableClick?.(view.name, schemaName);
          }}
        >
          <TableOutlined style={{ color: 'var(--ant-color-success)' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {schemaName !== 'public' ? `${schemaName}.${view.name}` : view.name}
          </span>
          <Tag color="green" style={{ marginInlineEnd: 0 }}>view</Tag>
        </span>
      ),
      children: (view.columns || []).map((column) => ({
        key: `view-column:${schemaName}.${view.name}.${column.name}`,
        title: (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}
            onClick={(event) => {
              event.stopPropagation();
              onColumnClick?.(view.name, column.name, schemaName);
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {column.name}
            </span>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {column.type}
            </Text>
          </span>
        ),
        isLeaf: true,
      })),
    };
  });

  return [
    ...(tableNodes.length ? [{ key: 'tables', title: `Tables (${tableNodes.length})`, children: tableNodes }] : []),
    ...(viewNodes.length ? [{ key: 'views', title: `Views (${viewNodes.length})`, children: viewNodes }] : []),
  ];
}

const QueryEditorDataPanel: React.FC<QueryEditorDataPanelProps> = ({
  onCollapse,
  onTableClick,
  onColumnClick,
  compact = false,
}) => {
  const {
    dataSources,
    selectedDataSourceId,
    dataSourceSchemas,
    selectDataSource,
    fetchDataSourceSchema,
    refreshDataSources,
    schemaLoading,
    isLoading,
  } = useDataSources();

  const selectedDataSource = useMemo(
    () => dataSources.find((ds) => ds.id === selectedDataSourceId) || dataSources[0] || null,
    [dataSources, selectedDataSourceId]
  );

  const selectedSchema = selectedDataSource ? dataSourceSchemas.get(selectedDataSource.id) : null;

  const selectAndLoad = useCallback(
    async (id: string) => {
      try {
        await selectDataSource(id);
        if (!dataSourceSchemas.has(id)) {
          await fetchDataSourceSchema(id);
        }
      } catch (error) {
        console.error('Failed to load data source schema:', error);
      }
    },
    [dataSourceSchemas, fetchDataSourceSchema, selectDataSource]
  );

  useEffect(() => {
    if (!selectedDataSource || selectedDataSourceId) return;
    void selectAndLoad(selectedDataSource.id);
  }, [selectAndLoad, selectedDataSource, selectedDataSourceId]);

  useEffect(() => {
    if (!selectedDataSource || selectedSchema || schemaLoading) return;
    fetchDataSourceSchema(selectedDataSource.id).catch((error) => {
      console.error('Failed to load data source schema:', error);
    });
  }, [fetchDataSourceSchema, schemaLoading, selectedDataSource, selectedSchema]);

  useEffect(() => {
    const handleCreated = (event: Event) => {
      const created = (event as CustomEvent<DataSource>).detail;
      void refreshDataSources();
      if (created?.id) {
        void selectAndLoad(created.id);
      }
    };

    window.addEventListener('datasource-created', handleCreated);
    return () => window.removeEventListener('datasource-created', handleCreated);
  }, [refreshDataSources, selectAndLoad]);

  const treeData = useMemo(
    () => buildTreeData(selectedSchema, onTableClick, onColumnClick),
    [onColumnClick, onTableClick, selectedSchema]
  );

  const openConnectDataModal = () => {
    window.dispatchEvent(new CustomEvent('query-editor-open-connect-data'));
  };

  return (
    <div
      className="data-panel"
      style={{
        height: compact ? 380 : '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--ant-color-bg-container)',
      }}
    >
      <div
        className="data-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '12px',
          borderBottom: '1px solid var(--ant-color-border-secondary)',
        }}
      >
        <Space size={8} style={{ minWidth: 0 }}>
          <DatabaseOutlined style={{ color: 'var(--ant-color-primary)' }} />
          <Text strong style={{ whiteSpace: 'nowrap' }}>Data Sources</Text>
          {dataSources.length ? <Tag style={{ marginInlineEnd: 0 }}>{dataSources.length}</Tag> : null}
        </Space>
        <Space size={2}>
          <Tooltip title="Add data source">
            <Button type="text" size="small" icon={<PlusOutlined />} onClick={openConnectDataModal} />
          </Tooltip>
          <Tooltip title="Refresh">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              loading={isLoading}
              onClick={() => void refreshDataSources()}
            />
          </Tooltip>
          {onCollapse ? (
            <Tooltip title="Collapse">
              <Button type="text" size="small" icon={<CompressOutlined />} onClick={onCollapse} />
            </Tooltip>
          ) : null}
        </Space>
      </div>

      <div
        className="data-content data-content-with-tree"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {isLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : dataSources.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data sources connected">
            <Button type="primary" icon={<PlusOutlined />} onClick={openConnectDataModal}>
              Connect Data Source
            </Button>
          </Empty>
        ) : (
          <>
            <div>
              <Text strong style={{ fontSize: 13 }}>Data source</Text>
              <Select
                value={selectedDataSource?.id}
                style={{ width: '100%', marginTop: 8 }}
                loading={isLoading}
                showSearch
                optionFilterProp="label"
                onChange={(id: string) => void selectAndLoad(id)}
                options={dataSources.map((ds) => ({
                  value: ds.id,
                  label: ds.name,
                  dataSource: ds,
                }))}
                optionRender={(option) => {
                  const ds = option.data.dataSource as DataSource;
                  return (
                    <Space size={8} style={{ minWidth: 0 }}>
                      <DataSourceIcon type={ds.type} dbType={ds.db_type} size={14} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ds.name}
                      </span>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {getDataSourceStatus(ds)}
                      </Text>
                    </Space>
                  );
                }}
              />
            </div>

            {selectedDataSource ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Space size={8} style={{ minWidth: 0 }}>
                  <DataSourceIcon type={selectedDataSource.type} dbType={selectedDataSource.db_type} size={16} />
                  <Text style={{ minWidth: 0 }} ellipsis>
                    {selectedDataSource.name}
                  </Text>
                </Space>
                <Tooltip title="Refresh schema">
                  <Button
                    type="text"
                    size="small"
                    icon={<TableOutlined />}
                    loading={schemaLoading}
                    onClick={() => {
                      fetchDataSourceSchema(selectedDataSource.id).catch((error) => {
                        console.error('Failed to load data source schema:', error);
                      });
                    }}
                  />
                </Tooltip>
              </div>
            ) : null}

            {schemaLoading ? (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <Spin size="small" />
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Loading schema</Text>
                </div>
              </div>
            ) : treeData.length ? (
              <div className="schema-tree-wrapper" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <Tree treeData={treeData} blockNode defaultExpandAll selectable={false} />
              </div>
            ) : selectedDataSource ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No schema available">
                <Button
                  onClick={() => {
                    fetchDataSourceSchema(selectedDataSource.id).catch((error) => {
                      console.error('Failed to load data source schema:', error);
                    });
                  }}
                >
                  Load Schema
                </Button>
              </Empty>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

export default QueryEditorDataPanel;
