'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Table, Typography } from 'antd';
import { TableOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';

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
          <div className="qe-results-loading">
            <AppLoadingIndicator variant="inline" tip={executionStatus || t('executing_query')} />
            <p className="qe-results-loading-copy" style={{ margin: 0, fontSize: 12 }}>
              {t('please_wait_processing')}
            </p>
          </div>
        ) : results && results.length > 0 ? (
          <Table
            className="qe-results-table"
            dataSource={paginatedResults}
            columns={columns}
            size="small"
            scroll={{ x: 'max-content', y: tableScrollY }}
            pagination={false}
            rowKey={(_record, index) => `row-${index}`}
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
