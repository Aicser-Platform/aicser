'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Col, Collapse, Empty, Progress, Row, Space, Spin, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import { PlayCircleOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { EChartsOption } from 'echarts';
import { fetchApi } from '@/utils/api';
import { MiniEChart } from '@/app/(dashboard)/feed/components/MiniEChart';

const { Text } = Typography;

// Read side of the answer golden set (server/ee/modules/ai/evals): each run asks the AI every
// golden question on the sample warehouse and checks the answer against ground-truth SQL.

interface AccuracyRun {
  id: string;
  trigger: 'nightly' | 'manual';
  status: 'running' | 'completed' | 'failed' | 'unavailable';
  questions: number | null;
  accuracy: number | null;
  mode_accuracy: number | null;
  p50_s: number | null;
  p95_s: number | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  report?: { by_locale?: Record<string, number>; by_shape?: Record<string, number>; by_schema?: Record<string, number> };
  failures?: Array<{ id: string; locale: string; shape: string; schema: string; reason: string }>;
}

const LANGUAGE: Record<string, string> = { en: 'English', km: 'ខ្មែរ', th: 'ไทย', vi: 'Tiếng Việt', zh: '中文', ja: '日本語', id: 'Bahasa Indonesia' };
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const tone = (v: number) => (v >= 0.9 ? 'var(--ant-color-success)' : v >= 0.8 ? 'var(--ant-color-warning)' : 'var(--ant-color-error)');

function Breakdown({ title, values, label }: { title: string; values?: Record<string, number>; label?: (k: string) => string }) {
  const entries = Object.entries(values || {}).sort((a, b) => a[1] - b[1]);
  if (!entries.length) return null;
  return (
    <Card size="small" title={title}>
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 40%) 1fr', gap: 8, alignItems: 'center' }}>
            <Text ellipsis title={label ? label(k) : k}>{label ? label(k) : k}</Text>
            <Progress percent={Math.round(v * 100)} size="small" strokeColor={tone(v)} />
          </div>
        ))}
      </Space>
    </Card>
  );
}

export function AnswerAccuracyCard() {
  const t = useTranslations('settings.ai_quality');
  const { message } = App.useApp();
  const [runs, setRuns] = useState<AccuracyRun[]>([]);
  const [nightly, setNightly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchApi<{ nightly_enabled: boolean; runs: AccuracyRun[] }>('api/ai/accuracy?limit=30');
      setRuns(res.runs || []);
      setNightly(Boolean(res.nightly_enabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('accuracy_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const start = async () => {
    setStarting(true);
    try {
      await fetchApi('api/ai/accuracy/run', { method: 'POST' });
      message.success(t('accuracy_started'));
      setTimeout(() => void load(), 1500);
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('accuracy_start_failed'));
    } finally {
      setStarting(false);
    }
  };

  const latest = runs.find((r) => r.status === 'completed');
  const inProgress = runs[0]?.status === 'running';
  const trend = useMemo<EChartsOption | null>(() => {
    const done = runs.filter((r) => r.status === 'completed' && r.accuracy != null).slice().reverse();
    if (done.length < 2) return null;
    return {
      grid: { left: 40, right: 16, top: 16, bottom: 28 },
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${Math.round(Number(v) * 100)}%` },
      xAxis: { type: 'category', data: done.map((r) => (r.started_at ? new Date(r.started_at).toLocaleDateString() : '')) },
      yAxis: { type: 'value', min: 0, max: 1, axisLabel: { formatter: (v: number) => `${Math.round(v * 100)}%` } },
      series: [{ type: 'line', name: t('accuracy_title'), smooth: true, areaStyle: { opacity: 0.12 }, data: done.map((r) => r.accuracy) }],
    };
  }, [runs, t]);

  return (
    <Card
      size="small"
      style={{ marginTop: 16 }}
      title={
        <Space size={6}>
          {t('accuracy_title')}
          <Tooltip title={t('accuracy_help')}>
            <QuestionCircleOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />
          </Tooltip>
        </Space>
      }
      extra={
        <Space size={4}>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} aria-label={t('accuracy_refresh')} />
          <Button size="small" type="primary" icon={<PlayCircleOutlined />} loading={starting} disabled={inProgress} onClick={() => void start()}>
            {inProgress ? t('accuracy_running') : t('accuracy_run_now')}
          </Button>
        </Space>
      }
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        {nightly ? t('accuracy_nightly_on') : t('accuracy_nightly_off')}
      </Text>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : !latest ? (
        <Empty description={inProgress ? t('accuracy_first_running') : t('accuracy_empty')} />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <Statistic title={t('accuracy_pass_rate')} value={pct(latest.accuracy)} valueStyle={{ color: tone(latest.accuracy ?? 0) }} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title={t('accuracy_questions')} value={latest.questions ?? 0} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title={t('accuracy_routing')} value={pct(latest.mode_accuracy)} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title={t('accuracy_speed')} value={latest.p50_s != null ? `${latest.p50_s}s` : '—'} suffix={latest.p95_s != null ? <Text type="secondary" style={{ fontSize: 12 }}>{t('accuracy_p95', { s: latest.p95_s })}</Text> : null} />
            </Col>
          </Row>
          <Text type="secondary">
            {t('accuracy_when', {
              date: latest.finished_at ? new Date(latest.finished_at).toLocaleString() : '—',
              trigger: latest.trigger === 'nightly' ? t('accuracy_trigger_nightly') : t('accuracy_trigger_manual'),
            })}
          </Text>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Breakdown title={t('accuracy_by_language')} values={latest.report?.by_locale} label={(k) => LANGUAGE[k] || k} />
            </Col>
            <Col xs={24} md={8}>
              <Breakdown title={t('accuracy_by_question')} values={latest.report?.by_shape} label={(k) => (t.has(`accuracy_shape_${k}` as never) ? t(`accuracy_shape_${k}` as never) : k)} />
            </Col>
            <Col xs={24} md={8}>
              <Breakdown title={t('accuracy_by_industry')} values={latest.report?.by_schema} label={(k) => k.replace(/_/g, ' ')} />
            </Col>
          </Row>
          {trend ? (
            <Card size="small" title={t('accuracy_trend')}>
              <MiniEChart option={trend} height={200} />
            </Card>
          ) : null}
          {latest.failures?.length ? (
            <Collapse
              items={[
                {
                  key: 'f',
                  label: (
                    <Space>
                      {t('accuracy_failed_questions')}
                      <Tag color="error">{latest.failures.length}</Tag>
                    </Space>
                  ),
                  children: (
                    <Table
                      size="small"
                      rowKey="id"
                      pagination={{ pageSize: 10 }}
                      dataSource={latest.failures}
                      columns={[
                        { title: t('accuracy_col_question'), dataIndex: 'id', ellipsis: true },
                        { title: t('accuracy_col_language'), dataIndex: 'locale', width: 110, render: (v: string) => LANGUAGE[v] || v },
                        { title: t('accuracy_col_reason'), dataIndex: 'reason', ellipsis: true },
                      ]}
                    />
                  ),
                },
              ]}
            />
          ) : null}
        </Space>
      )}
      {runs[0] && (runs[0].status === 'failed' || runs[0].status === 'unavailable') ? (
        <Alert type="warning" showIcon style={{ marginTop: 12 }} message={t('accuracy_last_failed')} description={runs[0].error || undefined} />
      ) : null}
    </Card>
  );
}
