'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Input, Select, Table, Tooltip, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { QueryEngineIcon } from '@/utils/queryEngineIcon';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';

export interface QueryHistoryPaneProps {
  queryHistory: any[];
  historySearch: string;
  historyStatusFilter: string;
  onHistorySearchChange: (value: string) => void;
  onHistoryStatusFilterChange: (value: string) => void;
  onHistoryItemClick: (sql: string) => void;
  onHistoryRerun: (record: any) => void;
  onHistoryRemove: (id: string | number) => Promise<void>;
}

function getEngineIcon(engine: string) {
  return <QueryEngineIcon engine={engine} />;
}

export function QueryHistoryPane({
  queryHistory,
  historySearch,
  historyStatusFilter,
  onHistorySearchChange,
  onHistoryStatusFilterChange,
  onHistoryItemClick,
  onHistoryRerun,
  onHistoryRemove,
}: QueryHistoryPaneProps) {
  const t = useTranslations('monaco_sql_editor');
  const tableHostRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(200);

  useEffect(() => {
    const host = tableHostRef.current;
    if (!host) return;

    const updateScroll = () => {
      setTableScrollY(Math.max(120, host.clientHeight - 4));
    };

    updateScroll();
    const observer = new ResizeObserver(updateScroll);
    observer.observe(host);
    return () => observer.disconnect();
  }, [queryHistory.length, historySearch, historyStatusFilter]);

  const historyColumns: ColumnsType<any> = useMemo(
    () => [
      {
        title: t('col_status'),
        key: 'status',
        width: 96,
        fixed: 'left',
        ellipsis: true,
        render: (_: unknown, record: any) => (
          <Badge
            status={record.state === 'success' ? 'success' : record.state === 'running' ? 'processing' : 'error'}
            text={
              <span className="qe-history-cell">
                {record.state === 'success'
                  ? t('filter_success')
                  : record.state === 'running'
                    ? t('executing_query')
                    : t('filter_failed')}
              </span>
            }
          />
        ),
      },
      {
        title: t('col_started'),
        dataIndex: 'started',
        key: 'started',
        width: 132,
        ellipsis: true,
        render: (value: string) => <span className="qe-history-cell qe-history-mono">{value}</span>,
      },
      {
        title: t('col_duration'),
        dataIndex: 'duration',
        key: 'duration',
        width: 72,
        ellipsis: true,
        render: (value: string) => <span className="qe-history-cell qe-history-mono">{value}</span>,
      },
      {
        title: t('col_rows'),
        dataIndex: 'rows',
        key: 'rows',
        width: 64,
        align: 'right',
        render: (value: number) => (
          <span className="qe-history-cell qe-history-mono">{value?.toLocaleString() ?? '—'}</span>
        ),
      },
      {
        title: t('col_engine'),
        dataIndex: 'engine',
        key: 'engine',
        width: 108,
        ellipsis: true,
        render: (value: string) => (
          <span className="qe-history-cell">
            {getEngineIcon(value)} {value}
          </span>
        ),
      },
      {
        title: t('col_sql_query'),
        dataIndex: 'sql',
        key: 'sql',
        ellipsis: true,
        render: (value: string) => (
          <Tooltip title={value} placement="topLeft">
            <button
              type="button"
              className="qe-history-sql-btn"
              onClick={(e) => {
                e.stopPropagation();
                onHistoryItemClick(value);
              }}
            >
              {value}
            </button>
          </Tooltip>
        ),
      },
      {
        title: t('col_actions'),
        key: 'actions',
        width: 84,
        fixed: 'right',
        align: 'center',
        render: (_: unknown, record: any) => (
          <div className="qe-history-actions" onClick={(e) => e.stopPropagation()}>
            <Tooltip title={t('tooltip_load_into_editor')}>
              <Button
                type="text"
                size="small"
                className="icon-only-btn qe-history-action-btn"
                icon={<EditOutlined />}
                aria-label={t('tooltip_load_into_editor')}
                onClick={() => onHistoryItemClick(record.sql)}
              />
            </Tooltip>
            <Tooltip title={t('tooltip_load_and_run')}>
              <Button
                type="text"
                size="small"
                className="icon-only-btn qe-history-action-btn"
                icon={<PlayCircleOutlined />}
                aria-label={t('tooltip_load_and_run')}
                onClick={() => onHistoryRerun(record)}
              />
            </Tooltip>
            <Tooltip title={t('tooltip_remove_from_history')}>
              <Button
                type="text"
                size="small"
                danger
                className="icon-only-btn qe-history-action-btn"
                icon={<DeleteOutlined />}
                aria-label={t('tooltip_remove_from_history')}
                onClick={async () => {
                  const id = record?.id ?? record?.history_id;
                  if (id == null) return;
                  try {
                    await onHistoryRemove(id);
                    message.success(t('removed_from_history'));
                  } catch (err: unknown) {
                    message.error(String(err));
                  }
                }}
              />
            </Tooltip>
          </div>
        ),
      },
    ],
    [onHistoryItemClick, onHistoryRerun, onHistoryRemove, t],
  );

  const filteredHistory = useMemo(() => {
    const search = (historySearch || '').toLowerCase().trim();
    const status = historyStatusFilter;
    return queryHistory.filter((r: any) => {
      if (status !== 'all' && (r.status || r.state) !== status) return false;
      if (!search) return true;
      return (r.sql || '').toLowerCase().includes(search) || (r.error || '').toLowerCase().includes(search);
    });
  }, [historySearch, historyStatusFilter, queryHistory]);

  return (
    <div className="qe-results-tab-body qe-history-pane">
      <div className="qe-history-filters">
        <Input
          placeholder={t('search_sql_or_error')}
          value={historySearch}
          onChange={(e) => onHistorySearchChange(e.target.value)}
          allowClear
          style={{ width: 220 }}
          size="small"
        />
        <Select
          value={historyStatusFilter}
          onChange={onHistoryStatusFilterChange}
          style={{ width: 120 }}
          size="small"
          options={[
            { value: 'all', label: t('filter_all') },
            { value: 'success', label: t('filter_success') },
            { value: 'error', label: t('filter_failed') },
          ]}
        />
      </div>
      <div ref={tableHostRef} className="qe-history-table-host">
        <Table
          dataSource={filteredHistory}
          columns={historyColumns}
          size="small"
          rowKey={(row) => String(row.id ?? row.history_id ?? row.started ?? row.sql)}
          className="query-history-table"
          scroll={{ x: 720, y: tableScrollY }}
          pagination={{
            pageSize: 25,
            size: 'small',
            showSizeChanger: true,
            pageSizeOptions: ['25', '50', '100'],
            showTotal: (total) => t('history_rows_total', { total }),
          }}
          onRow={(record) => ({
            onClick: () => {
              if (record.sql) onHistoryItemClick(record.sql);
            },
          })}
        />
      </div>
    </div>
  );
}
