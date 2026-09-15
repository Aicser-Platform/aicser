'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Table, Typography } from 'antd';
import { TableOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import { TableRowsSkeleton } from '@/components/ui/TableRowsSkeleton';

const { Text } = Typography;
const TABLE_PAGINATION_RESERVE = 0;

export interface ResultsTabPaneProps {
  results: Record<string, unknown>[];
  columns: ColumnsType<Record<string, unknown>>;
  isExecuting: boolean;
  loading: boolean;
  executionStatus?: string;
  executionTime?: number | null;
  resultLimitApplied?: boolean;
  rowLimit?: number;
  sqlQuery: string;
  latestSql: string;
  selectedDataSourceId?: string | null;
  currentPage?: number;
  pageSize?: number;
}

export function ResultsTabPane({
  results,
  columns,
  isExecuting,
  loading,
  executionStatus,
  currentPage = 1,
  pageSize = 100,
}: ResultsTabPaneProps) {
  const t = useTranslations('monaco_sql_editor');
  const tableHostRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(240);

  useEffect(() => {
    const host = tableHostRef.current;
    if (!host) return;

    const updateScroll = () => {
      const next = Math.max(120, host.clientHeight - TABLE_PAGINATION_RESERVE);
      setTableScrollY(next);
    };

    updateScroll();
    const observer = new ResizeObserver(updateScroll);
    observer.observe(host);
    return () => observer.disconnect();
  }, [results.length, isExecuting, loading]);

  const paginatedResults = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return results.slice(start, start + pageSize);
  }, [results, currentPage, pageSize]);

  return (
    <div className="qe-results-tab-body">
      <div ref={tableHostRef} className="qe-results-table-host data-content">
        {isExecuting || loading ? (
          results && results.length > 0 ? (
            // Re-running a query that already has results — keep the previous
            // rows' shape visible via a skeleton instead of blanking the pane.
            <div className="qe-results-loading qe-results-loading--skeleton">
              <div className="qe-results-loading-status">
                <AppLoadingIndicator variant="minimal" tip={executionStatus || t('executing_query')} />
              </div>
              <TableRowsSkeleton columns={columns.length || 6} rows={8} />
            </div>
          ) : (
            <div className="qe-results-loading qe-results-loading--skeleton">
              <div className="qe-results-loading-status">
                <AppLoadingIndicator variant="minimal" tip={executionStatus || t('executing_query')} />
                <span>{t('please_wait_processing')}</span>
              </div>
              <TableRowsSkeleton columns={6} rows={8} />
            </div>
          )
        ) : results && results.length > 0 ? (
          <Table
            className="qe-results-table"
            dataSource={paginatedResults}
            columns={columns}
            size="small"
            scroll={{ x: 'max-content', y: tableScrollY }}
            // antd v6's Spin no longer puts a stable class on the wrapper div
            // it renders around Table's body (dropped `ant-spin-nested-loading`
            // entirely unless told to via classNames.root) -- query-editor.css's
            // flex-fill scroll chain targets that exact class, so without this
            // the results table silently stopped scrolling after the v5->v6
            // antd bump. Table is never actually shown while loading here (see
            // the isExecuting/loading branch above), so spinning stays false;
            // this is purely to keep the class name antd v5 used to emit.
            loading={{ spinning: false, classNames: { root: 'ant-spin-nested-loading' } }}
            pagination={false}
            rowKey={(record) => `row-${paginatedResults.indexOf(record)}`}
            style={{ background: 'transparent' }}
          />
        ) : (
          <div className="qe-results-empty">
            <TableOutlined className="qe-results-empty-icon" aria-hidden />
            <p className="qe-results-empty-title">{t('no_results_to_display')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
