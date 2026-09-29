'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Select, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import type { TabComponentProps } from '../page';

const { Text, Paragraph } = Typography;

// Read side of the EE decision layer (server/ee/modules/ai/decisions): which typed
// decisions run on Jev/Laya, in which mode, and — from shadow traffic — whether each
// one is good enough to switch to primary.

interface QuestionSetStatus {
  name: string;
  version: number;
  mode: 'off' | 'shadow' | 'primary';
  thresholds: Record<string, number>;
}

interface LayerStatus {
  backend: 'off' | 'jev' | 'laya' | string;
  model: string | null;
  allowed_for_org?: boolean;
  question_sets: QuestionSetStatus[];
  ready_bar: { min_samples: number; min_agreement: number; max_p95_ms: number };
}

export interface DecisionStat {
  question_set: string;
  question_key: string;
  samples: number;
  confident_rate: number;
  agreement_when_confident: number | null;
  p95_ms: number | null;
  cost: number;
  error_rate: number;
  calibration_ece?: number | null;
  calibration_status?: 'ok' | 'drift' | 'insufficient' | null;
  ready_for_primary: boolean;
}

const DAY_OPTIONS = [7, 30, 90];
const pct = (v: number | null | undefined): string => (v == null ? '—' : `${Math.round(v * 100)}%`);

const MODE_COLOR: Record<string, string> = { off: 'default', shadow: 'blue', primary: 'green' };
const KNOWN_SETS = new Set([
  'front_door',
  'column_role',
  'decision_frame',
  'decision_review',
  'result_fit',
  'journey_phase',
  'chart_type',
  'decision_engines',
]);

const Hint: React.FC<{ label: string; hint: string }> = ({ label, hint }) => (
  <span>
    {label}{' '}
    <Tooltip title={hint}>
      <QuestionCircleOutlined style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }} />
    </Tooltip>
  </span>
);

export const AIDecisionLayerTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('settings.decision_layer');
  const [days, setDays] = useState(7);
  const [status, setStatus] = useState<LayerStatus | null>(null);
  const [stats, setStats] = useState<DecisionStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, sx] = await Promise.all([
        fetchApi<LayerStatus>('api/ai/decisions/status'),
        fetchApi<{ decisions: DecisionStat[] }>(`api/ai/decisions/stats?days=${days}`),
      ]);
      setStatus(st);
      setStats(sx?.decisions || []);
    } catch (err) {
      console.error('[AIDecisionLayerTab]', err);
      setError(t('load_error'));
    } finally {
      setLoading(false);
    }
  }, [days, t]);

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

  const modeBySet = useMemo(() => {
    const m: Record<string, string> = {};
    (status?.question_sets || []).forEach((qs) => {
      m[qs.name] = qs.mode;
    });
    return m;
  }, [status]);

  const columns: ColumnsType<DecisionStat> = [
    {
      title: t('col_decision'),
      key: 'decision',
      render: (_, r) => (
        <span>
          <Text strong>{KNOWN_SETS.has(r.question_set) ? t(`set_${r.question_set}` as never) : r.question_set}</Text>
          {r.question_key ? <Text type="secondary"> · {r.question_key}</Text> : null}
        </span>
      ),
    },
    {
      title: t('col_mode'),
      key: 'mode',
      render: (_, r) => {
        const mode = modeBySet[r.question_set] || 'off';
        return <Tag color={MODE_COLOR[mode]}>{t(`mode_${mode}` as never)}</Tag>;
      },
    },
    { title: t('col_samples'), dataIndex: 'samples', align: 'right' },
    {
      title: <Hint label={t('col_confident')} hint={t('col_confident_hint')} />,
      dataIndex: 'confident_rate',
      align: 'right',
      render: (v: number) => pct(v),
    },
    {
      title: <Hint label={t('col_agreement')} hint={t('col_agreement_hint')} />,
      dataIndex: 'agreement_when_confident',
      align: 'right',
      render: (v: number | null) => pct(v),
    },
    {
      title: t('col_p95'),
      dataIndex: 'p95_ms',
      align: 'right',
      render: (v: number | null) => (v == null ? '—' : `${v} ms`),
    },
    {
      title: <Hint label={t('col_calibration')} hint={t('col_calibration_hint')} />,
      key: 'calibration',
      align: 'right',
      render: (_, r) => {
        if (!r.calibration_status) return '—';
        const color = r.calibration_status === 'ok' ? 'green' : r.calibration_status === 'drift' ? 'red' : 'default';
        const ece = r.calibration_ece == null ? '' : ` · ${r.calibration_ece.toFixed(2)}`;
        return <Tag color={color}>{t(`calibration_${r.calibration_status}`)}{ece}</Tag>;
      },
    },
    {
      title: t('col_cost'),
      dataIndex: 'cost',
      align: 'right',
      render: (v: number) => `$${(v || 0).toFixed(4)}`,
    },
    {
      title: <Hint label={t('col_ready')} hint={t('col_ready_hint')} />,
      key: 'ready',
      render: (_, r) =>
        r.ready_for_primary ? <Tag color="green">{t('ready_yes')}</Tag> : <Tag>{t('ready_not_yet')}</Tag>,
    },
  ];

  const backend = status?.backend || 'off';

  // Every configured decision shows, even before it has traffic — otherwise an admin can't see
  // what is running in shadow until it happens to be exercised.
  const rows = useMemo<DecisionStat[]>(() => {
    const seen = new Set(stats.map((s) => s.question_set));
    const idle = (status?.question_sets || [])
      .filter((qs) => !seen.has(qs.name))
      .map((qs) => ({
        question_set: qs.name,
        question_key: '',
        samples: 0,
        confident_rate: 0,
        agreement_when_confident: null,
        p95_ms: null,
        cost: 0,
        error_rate: 0,
        ready_for_primary: false,
      }));
    return [...stats, ...idle];
  }, [stats, status]);

  return (
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

      {status ? (
        <Alert
          style={{ marginBottom: 16 }}
          type={backend === 'off' ? 'info' : 'success'}
          showIcon
          message={
            backend === 'off'
              ? t('backend_off')
              : t('backend_on', { backend: backend === 'jev' ? 'Jev' : 'Laya', model: status.model || '' })
          }
          description={
            backend === 'off' ? (
              <Paragraph style={{ margin: 0 }}>{t('enable_help')}</Paragraph>
            ) : (
              <Paragraph style={{ margin: 0 }}>
                {t('ready_bar', {
                  samples: status.ready_bar.min_samples,
                  agreement: Math.round(status.ready_bar.min_agreement * 100),
                  p95: status.ready_bar.max_p95_ms,
                })}
              </Paragraph>
            )
          }
        />
      ) : null}

      {status && status.allowed_for_org === false ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={t('blocked_by_residency')}
          description={
            <a href="/settings?tab=ai-residency">{t('open_residency')}</a>
          }
        />
      ) : null}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : rows.length === 0 ? (
        <Empty description={t('empty')} />
      ) : (
        <Table<DecisionStat>
          size="small"
          rowKey={(r) => `${r.question_set}.${r.question_key}`}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 760 }}
        />
      )}
    </Card>
  );
};

export default AIDecisionLayerTab;
