'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Space, Table, Tooltip, Typography } from 'antd';
import { DownloadOutlined, MoreOutlined, RocketOutlined, SaveOutlined, TableOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import { getChatHref } from '@/utils/appPaths';

const { Text } = Typography;
const TABLE_PAGINATION_RESERVE = 56;

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
  onSaveSnapshot: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
}

export function ResultsTabPane({
  results,
  columns,
  isExecuting,
  loading,
  executionStatus,
  executionTime,
  resultLimitApplied,
  rowLimit,
  sqlQuery,
  latestSql,
  selectedDataSourceId,
  onSaveSnapshot,
  onExportCsv,
  onExportJson,
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

  const exportMenuItems = [
    {
      key: 'csv',
      label: t('export_csv'),
      icon: <DownloadOutlined />,
      disabled: results.length === 0,
      onClick: onExportCsv,
    },
    {
      key: 'json',
      label: t('export_json'),
      icon: <DownloadOutlined />,
      disabled: results.length === 0,
      onClick: onExportJson,
    },
  ];

  return (
    <div className="qe-results-tab-body">
      <div className="qe-results-toolbar">
        <span className="qe-run-meta">
          {executionTime ? t('execution_time_ms', { ms: executionTime }) : null}
          {executionTime && results.length > 0 ? ' · ' : null}
          {results.length > 0 ? t('result_rows', { count: results.length }) : null}
          {resultLimitApplied && results.length > 0 ? (
            <Tooltip title={t('result_limited', { limit: rowLimit ?? 0 })}>
              <span> · {t('result_limited', { limit: Number(rowLimit).toLocaleString() })}</span>
            </Tooltip>
          ) : null}
        </span>
        <Space size={4} className="icon-toolbar qe-results-actions">
          {results.length > 0 ? (
            <Tooltip title={t('ask_ai_results_tip')}>
              <Button
                type="text"
                size="small"
                className="icon-only-btn"
                icon={<RocketOutlined />}
                aria-label={t('ask_ai_results_tip')}
                onClick={() => {
                  const sql = latestSql || sqlQuery;
                  const cols = results.length > 0 ? Object.keys(results[0]).join(', ') : '';
                  const promptText = `I ran this SQL query:\n${sql}\n\nThe result has ${results.length} rows with columns: ${cols}.\n\nHelp me understand and explore these results.`;
                  window.open(
                    getChatHref({
                      prompt: promptText,
                      dataSourceId: selectedDataSourceId || undefined,
                    }),
                    '_blank',
                  );
                }}
              />
            </Tooltip>
          ) : null}
          <Tooltip title={t('save_as_snapshot')}>
            <Button
              type="text"
              size="small"
              className="icon-only-btn"
              icon={<SaveOutlined />}
              aria-label={t('save_as_snapshot')}
              onClick={onSaveSnapshot}
              disabled={results.length === 0}
            />
          </Tooltip>
          <Dropdown menu={{ items: exportMenuItems }} trigger={['click']}>
            <Tooltip title={t('more_actions')}>
              <Button
                type="text"
                size="small"
                className="icon-only-btn qe-results-more-btn"
                icon={<MoreOutlined />}
                aria-label={t('more_actions')}
              />
            </Tooltip>
          </Dropdown>
        </Space>
      </div>
      <div ref={tableHostRef} className="qe-results-table-host data-content">
        {isExecuting || loading ? (
          <div className="qe-results-loading">
            <AppLoadingIndicator
              variant="inline"
              tip={executionStatus || t('executing_query')}
            />
            <p className="qe-results-loading-copy" style={{ margin: 0, fontSize: 12 }}>
              {t('please_wait_processing')}
            </p>
          </div>
        ) : results && results.length > 0 ? (
          <Table
            className="qe-results-table"
            dataSource={results}
            columns={columns}
            size="small"
            scroll={{ x: 'max-content', y: tableScrollY }}
            pagination={{
              pageSize: 100,
              showSizeChanger: true,
              pageSizeOptions: ['50', '100', '250', '500'],
              showTotal: (total, range) => t('rows_range_total', { from: range[0], to: range[1], total }),
            }}
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
