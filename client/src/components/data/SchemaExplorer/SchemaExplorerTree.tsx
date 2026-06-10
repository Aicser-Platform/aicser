'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tree, Tooltip } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { InfoCircleOutlined, TableOutlined } from '@ant-design/icons';
import type { DataSource as ContextDataSource, SchemaInfo as ContextSchemaInfo } from '@/stores/useDataSourceStore';
import { useTranslations } from 'next-intl';
import { abbreviateSqlType, ColumnTypeIcon } from './columnTypeMeta';

interface SchemaExplorerTreeProps {
  dataSource: ContextDataSource;
  schema: ContextSchemaInfo;
  filterText?: string;
  onTableClick?: (tableName: string, schemaName: string, dataSource: ContextDataSource) => void;
  onColumnClick?: (tableName: string, columnName: string, schemaName: string, dataSource: ContextDataSource) => void;
  /** @deprecated use filterText; compact hides tags only */
  compact?: boolean;
}

function columnMetaTooltip(
  col: { type?: string; primary_key?: boolean; unique?: boolean; foreign_key?: string; nullable?: boolean; default?: unknown },
  t: (key: string, values?: Record<string, string>) => string
): string {
  const parts: string[] = [];
  if (col.type) parts.push(col.type);
  if (col.primary_key) parts.push(t('pk'));
  if (col.unique) parts.push(t('unique'));
  if (col.foreign_key) parts.push(`${t('fk')}: ${col.foreign_key}`);
  if (col.nullable === false) parts.push(t('not_null'));
  if (col.default != null) parts.push(t('default_value', { value: String(col.default) }));
  return parts.join(' · ');
}

function matchesFilter(text: string, filter: string): boolean {
  if (!filter.trim()) return true;
  return text.toLowerCase().includes(filter.trim().toLowerCase());
}

const SchemaExplorerTree: React.FC<SchemaExplorerTreeProps> = ({
  dataSource,
  schema,
  filterText = '',
  onTableClick,
  onColumnClick,
  compact = true,
}) => {
  const t = useTranslations('schema_tree');
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const autoExpandedMarkerRef = useRef<string | null>(null);
  const filter = filterText.trim().toLowerCase();

  const { treeData, allExpandableKeys } = useMemo(() => {
    const expandableKeys: string[] = [];
    if (!schema) return { treeData: [], allExpandableKeys: expandableKeys };
    if (dataSource.type === 'cube' && schema.cubes) return { treeData: [], allExpandableKeys: expandableKeys };

    const nodes: DataNode[] = [];

    const buildColumnNode = (
      col: { name: string; type?: string; primary_key?: boolean; unique?: boolean; foreign_key?: string; nullable?: boolean; default?: unknown },
      tableName: string,
      schemaName: string,
      key: string
    ): DataNode | null => {
      const label = `${col.name} ${col.type || ''}`;
      if (filter && !matchesFilter(label, filter)) return null;
      return {
        key,
        title: (
          <div
            className={`schema-explorer-row schema-explorer-row--column${onColumnClick ? ' schema-explorer-row--clickable' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onColumnClick?.(tableName, col.name, schemaName, dataSource);
            }}
          >
            <ColumnTypeIcon type={col.type || ''} />
            <Tooltip title={columnMetaTooltip(col, t)}>
              <span className="schema-explorer-name">{col.name}</span>
            </Tooltip>
            <span className="schema-explorer-type-label">({abbreviateSqlType(col.type || '')})</span>
          </div>
        ),
        isLeaf: true,
      };
    };

    const buildTableNode = (
      table: { name: string; schema?: string; columns?: unknown[]; rowCount?: number | null; description?: string },
      schemaName: string
    ): DataNode | null => {
      const cols = Array.isArray(table.columns) ? table.columns : [];
      const colChildren = cols
        .map((col: any) =>
          buildColumnNode(col, table.name, schemaName, `${dataSource.id}_${schemaName}_${table.name}_${col.name}`)
        )
        .filter(Boolean) as DataNode[];

      const tableMatches = matchesFilter(table.name, filter) || colChildren.length > 0;
      if (!tableMatches) return null;

      const tableKey = `${dataSource.id}_${schemaName}_${table.name}`;
      if (colChildren.length > 0) expandableKeys.push(tableKey);
      return {
        key: tableKey,
        title: (
          <div
            className={`schema-explorer-row schema-explorer-row--table${onTableClick ? ' schema-explorer-row--clickable' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onTableClick?.(table.name, schemaName, dataSource);
            }}
          >
            <TableOutlined style={{ fontSize: 12, color: 'var(--ant-color-primary)', flexShrink: 0 }} />
            <span className="schema-explorer-name" title={table.name}>
              {table.name}
            </span>
            {table.description ? (
              <Tooltip title={table.description}>
                <InfoCircleOutlined style={{ fontSize: 11, color: 'var(--ant-color-text-tertiary)', flexShrink: 0 }} />
              </Tooltip>
            ) : null}
            {table.rowCount != null ? (
              <span className="schema-explorer-meta" title={`${table.rowCount} rows`}>
                {table.rowCount}
              </span>
            ) : null}
          </div>
        ),
        children: colChildren.length > 0 ? colChildren : undefined,
      };
    };

    if (
      (dataSource.type === 'database' || dataSource.type === 'sample_duckdb') &&
      (schema.schemas?.length || schema.tables?.some((tbl: any) => tbl.schema))
    ) {
      const schemaGroups: Record<string, ContextSchemaInfo['tables']> = {};
      schema.tables?.forEach((table) => {
        const schemaName = table.schema || 'public';
        if (!schemaGroups[schemaName]) schemaGroups[schemaName] = [];
        schemaGroups[schemaName]!.push(table);
      });

      Object.entries(schemaGroups).forEach(([schemaName, tables]) => {
        if (!tables) return;
        const tableChildren = tables
          .map((table) => buildTableNode(table, schemaName))
          .filter(Boolean) as DataNode[];

        const views = ((schema as any).views || []).filter((v: any) => (v.schema || 'public') === schemaName);
        const viewChildren = views
          .map((view: any) => buildTableNode({ ...view, columns: view.columns || [] }, schemaName))
          .filter(Boolean) as DataNode[];

        const allChildren = [...tableChildren, ...viewChildren];
        if (filter && allChildren.length === 0 && !matchesFilter(schemaName, filter)) return;

        const schemaKey = `${dataSource.id}_${schemaName}`;
        expandableKeys.push(schemaKey);
        nodes.push({
          key: schemaKey,
          title: (
            <div className="schema-explorer-row schema-explorer-row--schema">
              <span className="schema-explorer-name" title={schemaName}>
                {schemaName}
              </span>
              <span className="schema-explorer-meta">{tables.length}</span>
            </div>
          ),
          children: allChildren,
        });
      });
    } else if (schema.tables) {
      const tableChildren = schema.tables
        .map((table: any) => buildTableNode(table, table.schema || 'public'))
        .filter(Boolean) as DataNode[];

      if (tableChildren.length > 0) {
        const tablesRootKey = `${dataSource.id}_tables`;
        expandableKeys.push(tablesRootKey);
        nodes.push({
          key: tablesRootKey,
          title: (
            <div className="schema-explorer-row schema-explorer-row--schema">
              <span className="schema-explorer-name">{t('tables_views')}</span>
              <span className="schema-explorer-meta">{tableChildren.length}</span>
            </div>
          ),
          children: tableChildren,
        });
      }
    }

    if (!compact && schema.warning) {
      nodes.push({
        key: `${dataSource.id}_warning`,
        title: <span className="schema-explorer-name">⚠️ {schema.warning}</span>,
        isLeaf: true,
      });
    }

    return { treeData: nodes, allExpandableKeys: expandableKeys };
  }, [compact, dataSource, filter, onColumnClick, onTableClick, schema, t]);

  useEffect(() => {
    if (filter) {
      setExpandedKeys(allExpandableKeys);
      return;
    }

    const marker = `${dataSource.id}:${treeData.map((n) => n.key).join('|')}`;
    if (autoExpandedMarkerRef.current === marker || !treeData.length) return;

    const keys: string[] = [];
    const firstNode = treeData[0];
    if (firstNode?.key) {
      keys.push(String(firstNode.key));
      const firstTable = firstNode.children?.[0];
      if (firstTable?.key && firstTable.children?.length) {
        keys.push(String(firstTable.key));
      }
    }

    autoExpandedMarkerRef.current = marker;
    setExpandedKeys(keys);
  }, [filter, allExpandableKeys, treeData, dataSource.id]);

  if (!treeData.length) {
    return (
      <div className="schema-explorer-empty">
        {filter ? 'No matching tables or columns' : t('tables_views')}
      </div>
    );
  }

  return (
    <Tree
      className="schema-explorer-tree"
      treeData={treeData}
      expandedKeys={expandedKeys}
      onExpand={(keys) => setExpandedKeys(keys as string[])}
      blockNode
      showIcon={false}
      showLine={false}
    />
  );
};

export default SchemaExplorerTree;
