'use client';

import React, { useMemo, useState } from 'react';
import { Button, Empty, Input, Select, Spin, Tabs, Tooltip, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { CloseOutlined, DatabaseOutlined, SearchOutlined, TableOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useDataSourceSchema } from '@/hooks/useDataSources';
import type { ResultInfo } from './NotebookCell';
import { tableName } from './sqlCompletion';

const { Text } = Typography;

function quoted(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

/**
 * What there is to work with: the tables and columns of a data source, and the results this
 * notebook has made. Clicking a name types it into the cell being edited.
 */
export function DataSidebar({
  dataSources, sourceId, onSourceChange, results, onInsert, onClose,
}: {
  dataSources: Array<{ value: string; label: string }>;
  sourceId: string | null;
  onSourceChange: (id: string) => void;
  results: ResultInfo[];
  onInsert: (text: string, kind: 'table' | 'column' | 'result') => void;
  onClose: () => void;
}) {
  const t = useTranslations('notebooks');
  const { schema, isLoading } = useDataSourceSchema(sourceId);
  const [filter, setFilter] = useState('');

  const tree: DataNode[] = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (schema?.tables ?? [])
      .map((tb) => {
        const full = tableName(tb);
        const cols = (tb.columns ?? []).filter((c) => !q || full.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
        if (q && !cols.length && !full.toLowerCase().includes(q)) return null;
        return {
          key: `t:${full}`,
          title: (
            <span className="nb-side__node">
              <span>{full}</span>
              {tb.rowCount != null ? <Text type="secondary" className="nb-side__meta">{tb.rowCount.toLocaleString()}</Text> : null}
            </span>
          ),
          icon: <TableOutlined />,
          children: cols.map((c) => ({
            key: `c:${full}:${c.name}`,
            isLeaf: true,
            title: (
              <span className="nb-side__node">
                <span>{c.name}</span>
                <Text type="secondary" className="nb-side__meta">{c.type?.toLowerCase()}</Text>
              </span>
            ),
          })),
        } as DataNode;
      })
      .filter(Boolean) as DataNode[];
  }, [schema, filter]);

  const insertKey = (key: string) => {
    if (key.startsWith('t:')) onInsert(key.slice(2).split('.').map(quoted).join('.'), 'table');
    else if (key.startsWith('c:')) onInsert(quoted(key.slice(key.lastIndexOf(':') + 1)), 'column');
  };

  return (
    <aside className="nb-side" aria-label={t('sidebar')}>
      <Tabs
        size="small"
        tabBarExtraContent={<Tooltip title={t('hide_sidebar')}><Button size="small" type="text" icon={<CloseOutlined />} aria-label={t('hide_sidebar')} onClick={onClose} /></Tooltip>}
        items={[
          {
            key: 'data',
            label: t('side_data'),
            children: (
              <div className="nb-side__body">
                <Select
                  size="small"
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('choose_data')}
                  value={sourceId || undefined}
                  options={dataSources}
                  labelRender={({ label, value }) => label ?? (value ? t('data_unavailable') : null)}
                  style={{ width: '100%' }}
                  onChange={onSourceChange}
                  suffixIcon={<DatabaseOutlined />}
                  aria-label={t('choose_data')}
                />
                {sourceId ? (
                  <Input size="small" allowClear prefix={<SearchOutlined />} placeholder={t('side_filter')} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('side_filter')} />
                ) : null}
                {!sourceId ? (
                  <Text type="secondary" className="nb-side__hint">{t('side_pick_source')}</Text>
                ) : isLoading ? (
                  <Spin size="small" />
                ) : tree.length ? (
                  <>
                    <Text type="secondary" className="nb-side__hint">{t('side_click_to_insert')}</Text>
                    <Tree
                      showIcon
                      blockNode
                      treeData={tree}
                      defaultExpandedKeys={tree.length === 1 ? [String(tree[0].key)] : []}
                      onSelect={(keys) => keys[0] && insertKey(String(keys[0]))}
                      selectedKeys={[]}
                    />
                  </>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('side_no_tables')} />
                )}
              </div>
            ),
          },
          {
            key: 'results',
            label: t('side_results', { n: results.length }),
            children: (
              <div className="nb-side__body">
                {results.length ? (
                  <>
                    <Text type="secondary" className="nb-side__hint">{t('side_results_help')}</Text>
                    <ul className="nb-side__results">
                      {results.map((r) => (
                        <li key={r.name}>
                          <button type="button" onClick={() => onInsert(r.name, 'result')} className="nb-side__result">
                            <strong>{r.name}</strong>
                            <Text type="secondary" className="nb-side__meta">
                              {r.rows != null ? t('side_shape', { rows: r.rows, cols: r.columns.length }) : t('side_cols', { cols: r.columns.length })}
                            </Text>
                          </button>
                          <Text type="secondary" className="nb-side__cols" ellipsis={{ tooltip: r.columns.join(', ') }}>{r.columns.join(', ')}</Text>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <Text type="secondary" className="nb-side__hint">{t('side_no_results')}</Text>
                )}
              </div>
            ),
          },
        ]}
      />
    </aside>
  );
}
