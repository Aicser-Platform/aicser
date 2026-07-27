'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Select, Space, Spin, Tag, Tooltip, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  CompressOutlined,
  DatabaseOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
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

function matchesSearch(name: string, search: string): boolean {
  return name.toLowerCase().includes(search.toLowerCase());
}

/** A table/view is included if its own name matches (with all columns shown) or
 *  at least one column matches (with only matching columns shown). Returns null
 *  when searching and nothing in this table/view matches, so the caller can drop it. */
function buildEntryNode<T extends { name: string; schema?: string; columns?: { name: string; type: string }[] }>(
  entry: T,
  keyPrefix: string,
  columnKeyPrefix: string,
  search: string,
  icon: React.ReactNode,
  extraTag: React.ReactNode,
  onClick?: (name: string, schemaName: string) => void,
  onColumnClick?: (name: string, columnName: string, schemaName: string) => void
): DataNode | null {
  const schemaName = getSchemaName(entry.schema);
  const columns = entry.columns || [];
  const nameMatches = !search || matchesSearch(entry.name, search);
  const matchingColumns = !search || nameMatches ? columns : columns.filter((c) => matchesSearch(c.name, search));
  if (search && !nameMatches && matchingColumns.length === 0) return null;

  return {
    key: `${keyPrefix}:${schemaName}.${entry.name}`,
    title: (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.(entry.name, schemaName);
        }}
      >
        {icon}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {schemaName !== 'public' ? `${schemaName}.${entry.name}` : entry.name}
        </span>
        {extraTag}
      </span>
    ),
    children: matchingColumns.map((column) => ({
      key: `${columnKeyPrefix}:${schemaName}.${entry.name}.${column.name}`,
      title: (
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}
          onClick={(event) => {
            event.stopPropagation();
            onColumnClick?.(entry.name, column.name, schemaName);
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
}

function buildTreeData(
  schema: SchemaInfo | null | undefined,
  onTableClick?: (tableName: string, schemaName: string) => void,
  onColumnClick?: (tableName: string, columnName: string, schemaName: string) => void,
  search = ''
): { data: DataNode[]; matchKeys: string[] } {
  if (!schema) return { data: [], matchKeys: [] };

  const tableNodes = (schema.tables || [])
    .map((table) =>
      buildEntryNode(
        table,
        'table',
        'column',
        search,
        <TableOutlined style={{ color: 'var(--ant-color-primary)' }} />,
        typeof table.rowCount === 'number' ? (
          <Tag style={{ marginInlineEnd: 0 }}>{table.rowCount.toLocaleString()}</Tag>
        ) : null,
        onTableClick,
        onColumnClick
      )
    )
    .filter((node): node is DataNode => node !== null);

  const viewNodes = (schema.views || [])
    .map((view) =>
      buildEntryNode(
        view,
        'view',
        'view-column',
        search,
        <TableOutlined style={{ color: 'var(--ant-color-success)' }} />,
        <Tag color="green" style={{ marginInlineEnd: 0 }}>view</Tag>,
        onTableClick,
        onColumnClick
      )
    )
    .filter((node): node is DataNode => node !== null);

  const data: DataNode[] = [
    ...(tableNodes.length ? [{ key: 'tables', title: `Tables (${tableNodes.length})`, children: tableNodes }] : []),
    ...(viewNodes.length ? [{ key: 'views', title: `Views (${viewNodes.length})`, children: viewNodes }] : []),
  ];

  // While searching, auto-expand every group/table/view that has a match so results
  // are visible without the user having to expand each one by hand.
  const matchKeys = search
    ? [
        ...(tableNodes.length ? ['tables'] : []),
        ...(viewNodes.length ? ['views'] : []),
        ...tableNodes.map((n) => String(n.key)),
        ...viewNodes.map((n) => String(n.key)),
      ]
    : [];

  return { data, matchKeys };
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

  const [search, setSearch] = useState('');
  const { data: treeData, matchKeys } = useMemo(
    () => buildTreeData(selectedSchema, onTableClick, onColumnClick, search),
    [onColumnClick, onTableClick, selectedSchema, search]
  );

  // Collapsed by default (schema trees with 50+ tables are unusable fully expanded);
  // expand automatically to reveal matches while the user is searching.
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  useEffect(() => {
    if (search) setExpandedKeys(matchKeys);
  }, [search, matchKeys]);

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
            ) : selectedSchema ? (
              <>
                <Input
                  size="small"
                  allowClear
                  prefix={<SearchOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />}
                  placeholder="Filter tables and columns…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {treeData.length ? (
                  <div className="schema-tree-wrapper" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                    <Tree
                      treeData={treeData}
                      blockNode
                      selectable={false}
                      expandedKeys={expandedKeys}
                      onExpand={setExpandedKeys}
                    />
                  </div>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={search ? `No tables or columns match "${search}"` : 'No schema available'}
                  />
                )}
              </>
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
