'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Select, Spin, Statistic, Tooltip, Typography } from 'antd';
import { ReloadOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { EChartsOption } from 'echarts';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/hooks/usePermissions';
import { fetchApi } from '@/utils/api';
import { MiniEChart } from '@/app/(dashboard)/feed/components/MiniEChart';
import type { TabComponentProps } from '../page';

const { Text } = Typography;

// response_finalizer_node's grounding evaluation and the agent kernel's
// goal-verification pass/fail are already computed on every analytics turn
// (see server/ee/modules/ai/services/quality_metrics_service.py) — this tab
// is the read side of that, org-admin-only (audit:view, same tier as the
// Audit Log tab it sits next to).

interface QualitySummary {
  total_turns: number;
  avg_grounding_score: number | null;
  goal_verification_pass_rate: number | null;
  thumbs_up_rate: number | null;
  error_rate: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  window_days: number;
}

interface QualityPoint {
  date: string;
  total_turns: number;
  avg_grounding_score: number | null;
  goal_verification_pass_rate: number | null;
  thumbs_up_rate: number | null;
  error_rate: number;
}

const DAY_OPTIONS = [7, 30, 90];

const pct = (v: number | null): string => (v == null ? '—' : `${Math.round(v * 100)}%`);

/** Statistic title + an info tooltip explaining what the metric actually
 * measures — these are backend-computed signals (grounding score, goal
 * verification) with no obvious meaning from the label alone. */
const TitleWithHint: React.FC<{ label: string; hint: string }> = ({ label, hint }) => (
  <span>
    {label}{' '}
    <Tooltip title={hint}>
      <QuestionCircleOutlined style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }} />
    </Tooltip>
  </span>
);

export const AIQualityTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('settings.ai_quality');
  const { currentOrganization } = useOrganizationStore();
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<QualitySummary | null>(null);
  const [points, setPoints] = useState<QualityPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentOrganization?.id) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ organization_id: String(currentOrganization.id), days: String(days) });
      const [summaryRes, seriesRes] = await Promise.all([
        fetchApi(`ai/quality-metrics/summary?${params.toString()}`),
        fetchApi(`ai/quality-metrics/timeseries?${params.toString()}`),
      ]);
      setSummary(summaryRes);
      setPoints(seriesRes?.points || []);
    } catch (err) {
      console.error('[AIQualityTab]', err);
      setError(t('load_error'));
      setSummary(null);
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [currentOrganization?.id, days, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onSetAction?.(
      <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
        {t('refresh')}
      </Button>
    );
  }, [loading, onSetAction, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const trendOption: EChartsOption = useMemo(() => {
    const dates = points.map((p) => p.date);
    return {
      grid: { left: 44, right: 16, top: 32, bottom: 28 },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      tooltip: { trigger: 'axis', valueFormatter: (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v)) },
      xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', min: 0, max: 1, axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%`, fontSize: 10 } },
      series: [
        {
          name: t('chart_grounding'),
          type: 'line',
          smooth: true,
          data: points.map((p) => p.avg_grounding_score),
          connectNulls: true,
        },
        {
          name: t('chart_goal_verification'),
          type: 'line',
          smooth: true,
          data: points.map((p) => p.goal_verification_pass_rate),
          connectNulls: true,
        },
        {
          name: t('chart_thumbs_up'),
          type: 'line',
          smooth: true,
          data: points.map((p) => p.thumbs_up_rate),
          connectNulls: true,
        },
      ],
    };
  }, [points, t]);

  return (
    <PermissionGuard permission={Permission.AUDIT_VIEW} fallback={<Alert type="warning" message={t('no_permission')} showIcon />}>
      <Card size="small" variant="borderless" style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <Text type="secondary">{t('subtitle')}</Text>
          <Select
            value={days}
            onChange={setDays}
            style={{ width: 160 }}
            aria-label={t('window_label')}
            options={DAY_OPTIONS.map((d) => ({ value: d, label: t('window_days', { days: d }) }))}
          />
        </div>

        {error ? <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon /> : null}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : !summary || summary.total_turns === 0 ? (
          <Empty description={t('empty')} />
        ) : (
          <>
            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col xs={12} sm={8} md={3}>
                <Card size="small">
                  <Statistic title={<TitleWithHint label={t('kpi_turns')} hint={t('kpi_turns_hint')} />} value={summary.total_turns} />
                </Card>
              </Col>
              <Col xs={12} sm={8} md={3}>
                <Card size="small">
                  <Statistic
                    title={<TitleWithHint label={t('kpi_grounding')} hint={t('kpi_grounding_hint')} />}
                    value={pct(summary.avg_grounding_score)}
                    valueStyle={
                      summary.avg_grounding_score != null && summary.avg_grounding_score < 0.6
                        ? { color: 'var(--ant-color-warning)' }
                        : undefined
                    }
                  />
                </Card>
              </Col>
              <Col xs={12} sm={8} md={3}>
                <Card size="small">
                  <Statistic
                    title={<TitleWithHint label={t('kpi_goal_verification')} hint={t('kpi_goal_verification_hint')} />}
                    value={pct(summary.goal_verification_pass_rate)}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={8} md={3}>
                <Card size="small">
                  <Statistic
                    title={<TitleWithHint label={t('kpi_thumbs_up')} hint={t('kpi_thumbs_up_hint')} />}
                    value={pct(summary.thumbs_up_rate)}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={8} md={3}>
                <Card size="small">
                  <Statistic
                    title={<TitleWithHint label={t('kpi_error_rate')} hint={t('kpi_error_rate_hint')} />}
                    value={pct(summary.error_rate)}
                    valueStyle={summary.error_rate > 0.05 ? { color: 'var(--ant-color-error)' } : undefined}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={8} md={3}>
                <Card size="small">
                  <Statistic
                    title={<TitleWithHint label={t('kpi_latency')} hint={t('kpi_latency_hint')} />}
                    value={summary.avg_latency_ms != null ? Math.round(summary.avg_latency_ms / 1000) : '—'}
                    suffix={summary.avg_latency_ms != null ? 's' : undefined}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={8} md={3}>
                <Card size="small">
                  <Statistic
                    title={<TitleWithHint label={t('kpi_p95_latency')} hint={t('kpi_p95_latency_hint')} />}
                    value={summary.p95_latency_ms != null ? Math.round(summary.p95_latency_ms / 1000) : '—'}
                    suffix={summary.p95_latency_ms != null ? 's' : undefined}
                    valueStyle={
                      summary.p95_latency_ms != null && summary.avg_latency_ms != null && summary.p95_latency_ms > summary.avg_latency_ms * 2
                        ? { color: 'var(--ant-color-warning)' }
                        : undefined
                    }
                  />
                </Card>
              </Col>
            </Row>

            {points.length > 1 ? (
              <Card size="small" title={t('chart_title')}>
                <MiniEChart option={trendOption} height={280} />
              </Card>
            ) : null}
          </>
        )}
      </Card>
    </PermissionGuard>
  );
};

export default AIQualityTab;
