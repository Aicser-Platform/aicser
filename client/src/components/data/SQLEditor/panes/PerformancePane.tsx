'use client';

import React, { useCallback, useState } from 'react';
import { Badge, Button, Card, Space, Tag, Typography, message } from 'antd';
import { BulbOutlined, CheckCircleOutlined, CopyOutlined, FileTextOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';

const { Text } = Typography;

export interface PerformancePaneProps {
  sqlQuery: string;
  selectedDataSourceId?: string | null;
  selectedDataSource?: { id?: string } | null;
  isDarkMode?: boolean;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<any>;
  formatError: (error: unknown, code: string, fallback: string) => string;
}

export function PerformancePane({
  sqlQuery,
  selectedDataSourceId,
  selectedDataSource,
  isDarkMode,
  authenticatedFetch,
  formatError,
}: PerformancePaneProps) {
  const t = useTranslations('monaco_sql_editor');
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfPlan, setPerfPlan] = useState<unknown>(null);
  const [perfSuggestions, setPerfSuggestions] = useState<string[]>([]);

  const handleAnalyzePerformance = useCallback(async () => {
    if (!selectedDataSourceId && !selectedDataSource?.id) {
      message.warning(t('select_ds_analyze'));
      return;
    }
    if (!sqlQuery || !sqlQuery.trim()) {
      message.warning(t('enter_sql_analyze'));
      return;
    }
    setPerfLoading(true);
    setPerfPlan(null);
    setPerfSuggestions([]);
    try {
      const dataSourceId = selectedDataSource?.id || selectedDataSourceId || '';
      const j = await authenticatedFetch(`/api/data/sources/${dataSourceId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlQuery }),
      });
      setPerfPlan(j.plan ?? null);
      setPerfSuggestions(j.suggestions || []);
      message.success(
        `Analysis complete${j.suggestions?.length ? ` — ${j.suggestions.length} suggestions` : ''}`,
      );
    } catch (e: unknown) {
      message.error(formatError(e, 'generic', t('analysis_failed_short')));
      setPerfPlan(null);
      setPerfSuggestions([]);
    } finally {
      setPerfLoading(false);
    }
  }, [authenticatedFetch, formatError, selectedDataSource, selectedDataSourceId, sqlQuery, t]);

  const copyPlan = useCallback(() => {
    if (!perfPlan) return;
    void navigator.clipboard.writeText(JSON.stringify(perfPlan, null, 2));
    message.success(t('plan_copied_short'));
  }, [perfPlan, t]);

  return (
    <div className="qe-results-tab-body qe-performance-pane">
      <div className="qe-performance-pane__inner">
        <div className="qe-performance-pane__main">
          <Space className="qe-performance-pane__actions" size={8}>
            <Button
              type="primary"
              size="small"
              icon={<BulbOutlined />}
              loading={perfLoading}
              onClick={() => void handleAnalyzePerformance()}
            >
              {t('analyze_query_performance')}
            </Button>
            {perfPlan ? (
              <Button size="small" icon={<CopyOutlined />} onClick={copyPlan}>
                {t('copy_plan')}
              </Button>
            ) : null}
          </Space>
          <Card
            size="small"
            className="qe-performance-pane__suggestions"
            title={
              <Space>
                <BulbOutlined />
                <span>{t('performance_suggestions')}</span>
                {perfSuggestions.length > 0 ? (
                  <Badge count={perfSuggestions.length} style={{ backgroundColor: '#52c41a' }} />
                ) : null}
              </Space>
            }
          >
            <div className="data-content qe-performance-pane__suggestions-scroll">
              {perfSuggestions.length ? (
                <ul className="qe-performance-pane__suggestion-list">
                  {perfSuggestions.map((s, i) => (
                    <li key={i}>
                      <CheckCircleOutlined style={{ color: '#52c41a', marginRight: '6px' }} />
                      {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic' }}>
                  {perfLoading ? t('analyzing_query') : t('no_suggestions_yet')}
                </Text>
              )}
            </div>
          </Card>
          <Card
            size="small"
            className="qe-performance-pane__plan"
            title={
              <Space>
                <FileTextOutlined />
                <span>{t('execution_plan')}</span>
                {perfPlan ? <Tag color="success">{t('available')}</Tag> : null}
              </Space>
            }
            extra={
              perfPlan ? (
                <Button size="small" type="text" icon={<CopyOutlined />} onClick={copyPlan}>
                  {t('copy_plan')}
                </Button>
              ) : null
            }
          >
            <div className="data-content qe-performance-pane__plan-scroll">
              <pre className="qe-performance-pane__plan-pre">
                {perfPlan ? (
                  JSON.stringify(perfPlan, null, 2)
                ) : (
                  <Text type="secondary" style={{ fontStyle: 'italic' }}>
                    {perfLoading ? t('generating_execution_plan') : t('no_execution_plan_yet')}
                  </Text>
                )}
              </pre>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
