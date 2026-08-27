'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Space, Tag, Tree, Typography, message } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { BulbOutlined, CheckCircleOutlined, CopyOutlined, FileTextOutlined, NodeIndexOutlined } from '@ant-design/icons';
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

type PlanNode = Record<string, unknown>;

/** Postgres `EXPLAIN (FORMAT JSON)` shape: an array of `{ Plan: {...}, "Planning Time"?, "Execution Time"? }`. */
function isPostgresPlanArray(plan: unknown): plan is Array<{ Plan: PlanNode; [key: string]: unknown }> {
  return (
    Array.isArray(plan) &&
    plan.length > 0 &&
    typeof plan[0] === 'object' &&
    plan[0] !== null &&
    'Plan' in (plan[0] as object)
  );
}

/** Row-shaped plans (ClickHouse `EXPLAIN PLAN`, generic `EXPLAIN`): array of single-key rows of plan text. */
function isFlatTextRowArray(plan: unknown): plan is Array<Record<string, unknown>> {
  return (
    Array.isArray(plan) &&
    plan.length > 0 &&
    plan.every((row) => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length === 1)
  );
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
}

interface PlanLabels {
  rowsEstimate: (rows: string) => string;
  rowsEstimateActual: (estRows: string, actualRows: string) => string;
  cost: (cost: string) => string;
  timeMs: (ms: string) => string;
  timeMsLoops: (ms: string, loops: string) => string;
  planningTime: (ms: string) => string;
  executionTime: (ms: string) => string;
  queryPlanLabel: string;
}

function planCostTag(node: PlanNode, labels: PlanLabels): string | null {
  const startup = node['Startup Cost'];
  const total = node['Total Cost'];
  if (typeof startup === 'number' && typeof total === 'number') {
    return labels.cost(`${formatNumber(startup)}..${formatNumber(total)}`);
  }
  if (typeof total === 'number') return labels.cost(formatNumber(total));
  return null;
}

function planRowsTag(node: PlanNode, labels: PlanLabels): string | null {
  const planRows = node['Plan Rows'];
  const actualRows = node['Actual Rows'];
  if (typeof actualRows === 'number' && typeof planRows === 'number') {
    return labels.rowsEstimateActual(formatNumber(planRows), formatNumber(actualRows));
  }
  if (typeof planRows === 'number') return labels.rowsEstimate(formatNumber(planRows));
  return null;
}

function planTimeTag(node: PlanNode, labels: PlanLabels): string | null {
  const t = node['Actual Total Time'];
  const loops = node['Actual Loops'];
  if (typeof t !== 'number') return null;
  if (typeof loops === 'number' && loops !== 1) {
    return labels.timeMsLoops(formatNumber(t), formatNumber(loops));
  }
  return labels.timeMs(formatNumber(t));
}

const PLAN_DETAIL_KEYS = ['Filter', 'Index Cond', 'Join Filter', 'Hash Cond', 'Sort Key', 'Recheck Cond', 'Merge Cond'];

function buildPostgresPlanNode(node: PlanNode, keyPrefix: string, labels: PlanLabels): DataNode {
  const nodeType = String(node['Node Type'] ?? 'Plan');
  const relation = node['Relation Name'] || node['Index Name'] || node['CTE Name'];
  const joinType = node['Join Type'];
  const cost = planCostTag(node, labels);
  const rows = planRowsTag(node, labels);
  const time = planTimeTag(node, labels);

  const detailChildren: DataNode[] = PLAN_DETAIL_KEYS.filter((k) => node[k] !== undefined && node[k] !== null).map(
    (k, i) => {
      const raw = node[k];
      const value = Array.isArray(raw) ? raw.join(', ') : String(raw);
      return {
        key: `${keyPrefix}-detail-${i}`,
        isLeaf: true,
        selectable: false,
        title: (
          <span style={{ fontSize: 12 }}>
            <Text type="secondary" strong style={{ marginRight: 4 }}>
              {k}:
            </Text>
            <Text code style={{ fontSize: 11 }}>
              {value}
            </Text>
          </span>
        ),
      };
    }
  );

  const childPlans = ((node['Plans'] as PlanNode[] | undefined) || []).map((child, i) =>
    buildPostgresPlanNode(child, `${keyPrefix}-${i}`, labels)
  );

  const children = [...detailChildren, ...childPlans];

  return {
    key: keyPrefix,
    selectable: false,
    isLeaf: children.length === 0,
    children: children.length ? children : undefined,
    title: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '2px 0' }}>
        <NodeIndexOutlined style={{ color: 'var(--ant-color-primary)' }} />
        <Text strong style={{ fontSize: 12 }}>
          {nodeType}
          {joinType ? ` (${String(joinType)})` : ''}
        </Text>
        {relation ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            on {String(relation)}
          </Text>
        ) : null}
        {cost ? (
          <Tag style={{ marginInlineEnd: 0 }} bordered={false}>
            {cost}
          </Tag>
        ) : null}
        {rows ? (
          <Tag color="blue" style={{ marginInlineEnd: 0 }} bordered={false}>
            {rows}
          </Tag>
        ) : null}
        {time ? (
          <Tag color="success" style={{ marginInlineEnd: 0 }} bordered={false}>
            {time}
          </Tag>
        ) : null}
      </span>
    ),
  };
}

function jsonValueToTreeNode(value: unknown, keyPath: string, label: string): DataNode {
  if (value === null || value === undefined) {
    return { key: keyPath, isLeaf: true, selectable: false, title: renderKeyValue(label, 'null') };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { key: keyPath, isLeaf: true, selectable: false, title: renderKeyValue(label, '[]') };
    }
    return {
      key: keyPath,
      selectable: false,
      title: (
        <span style={{ fontSize: 12 }}>
          <Text strong>{label}</Text>{' '}
          <Tag style={{ marginInlineEnd: 0 }} bordered={false}>
            {value.length}
          </Tag>
        </span>
      ),
      children: value.map((v, i) => jsonValueToTreeNode(v, `${keyPath}-${i}`, `[${i}]`)),
    };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return { key: keyPath, isLeaf: true, selectable: false, title: renderKeyValue(label, '{}') };
    }
    return {
      key: keyPath,
      selectable: false,
      title: (
        <Text strong style={{ fontSize: 12 }}>
          {label}
        </Text>
      ),
      children: entries.map(([k, v], i) => jsonValueToTreeNode(v, `${keyPath}-${i}`, k)),
    };
  }
  return { key: keyPath, isLeaf: true, selectable: false, title: renderKeyValue(label, String(value)) };
}

function renderKeyValue(label: string, value: string) {
  return (
    <span style={{ fontSize: 12 }}>
      <Text strong style={{ marginRight: 4 }}>
        {label}:
      </Text>
      <Text type="secondary">{value}</Text>
    </span>
  );
}

/** Builds a collapsible antd Tree from a heterogeneous EXPLAIN plan payload — Postgres's
 * structured JSON plan gets cost/row/time badges per node; anything else (ClickHouse/generic
 * EXPLAIN text rows, or an unrecognized shape) still renders as a readable tree instead of
 * a raw JSON dump. */
function buildPlanTreeData(plan: unknown, labels: PlanLabels): DataNode[] {
  if (plan === null || plan === undefined) return [];

  if (isPostgresPlanArray(plan)) {
    return plan.map((entry, i) => {
      const root = buildPostgresPlanNode(entry.Plan, `plan-${i}-root`, labels);
      const planningTime = entry['Planning Time'];
      const executionTime = entry['Execution Time'];
      const summaryTags: React.ReactNode[] = [];
      if (typeof planningTime === 'number') {
        summaryTags.push(
          <Tag key="pt" bordered={false}>
            {labels.planningTime(formatNumber(planningTime))}
          </Tag>
        );
      }
      if (typeof executionTime === 'number') {
        summaryTags.push(
          <Tag key="et" color="success" bordered={false}>
            {labels.executionTime(formatNumber(executionTime))}
          </Tag>
        );
      }
      if (!summaryTags.length) return root;
      return {
        key: `plan-${i}`,
        selectable: false,
        title: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Text strong style={{ fontSize: 12 }}>
              {labels.queryPlanLabel}
            </Text>
            {summaryTags}
          </span>
        ),
        children: [root],
      };
    });
  }

  if (isFlatTextRowArray(plan)) {
    return plan.map((row, i) => {
      const [, value] = Object.entries(row)[0] || ['', ''];
      return {
        key: `row-${i}`,
        isLeaf: true,
        selectable: false,
        title: (
          <Text code style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {String(value)}
          </Text>
        ),
      };
    });
  }

  return [jsonValueToTreeNode(plan, 'root', labels.queryPlanLabel)];
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
  const [perfPlanError, setPerfPlanError] = useState<string | null>(null);
  const [perfSuggestions, setPerfSuggestions] = useState<string[]>([]);

  const planLabels: PlanLabels = useMemo(
    () => ({
      rowsEstimate: (rows) => t('plan_rows_estimate', { rows }),
      rowsEstimateActual: (estRows, actualRows) => t('plan_rows_estimate_actual', { estRows, actualRows }),
      cost: (cost) => t('plan_cost', { cost }),
      timeMs: (ms) => t('plan_time_ms', { ms }),
      timeMsLoops: (ms, loops) => t('plan_time_ms_loops', { ms, loops }),
      planningTime: (ms) => t('plan_planning_time', { ms }),
      executionTime: (ms) => t('plan_execution_time', { ms }),
      queryPlanLabel: t('plan_query_label'),
    }),
    [t]
  );

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
    setPerfPlanError(null);
    setPerfSuggestions([]);
    try {
      const dataSourceId = selectedDataSource?.id || selectedDataSourceId || '';
      const j = await authenticatedFetch(`/api/data/sources/${dataSourceId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlQuery }),
      });
      setPerfPlan(j.plan ?? null);
      setPerfPlanError(j.plan_error || null);
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

  const planTreeData = useMemo(() => buildPlanTreeData(perfPlan, planLabels), [perfPlan, planLabels]);

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
                  <Badge count={perfSuggestions.length} style={{ backgroundColor: 'var(--ant-color-success)' }} />
                ) : null}
              </Space>
            }
          >
            <div className="data-content qe-performance-pane__suggestions-scroll">
              {perfSuggestions.length ? (
                <ul className="qe-performance-pane__suggestion-list">
                  {perfSuggestions.map((s, i) => (
                    <li key={i}>
                      <CheckCircleOutlined style={{ color: 'var(--ant-color-success)', marginRight: '6px' }} />
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
              {planTreeData.length ? (
                <Tree
                  treeData={planTreeData}
                  blockNode
                  selectable={false}
                  defaultExpandAll
                  className="qe-performance-pane__plan-tree"
                />
              ) : perfPlanError ? (
                <Alert
                  type="warning"
                  showIcon
                  message={t('plan_error_prefix')}
                  description={perfPlanError}
                  style={{ marginBottom: 0 }}
                />
              ) : (
                <Text type="secondary" style={{ fontStyle: 'italic' }}>
                  {perfLoading ? t('generating_execution_plan') : t('no_execution_plan_yet')}
                </Text>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
