'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Select, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/hooks/usePermissions';
import { fetchApi } from '@/utils/api';
import type { TabComponentProps } from '../page';

const { Text } = Typography;

// Read side of llm_audit_log (server/ee/modules/ai/services/audit_log_service.py) —
// every LLM call the platform makes is already recorded there (model, node,
// tokens, latency, outcome, conversation_id); this is the first UI over it.
// Same org-admin gate as the AI Quality tab it sits next to (audit:view).

interface AuditLogRow {
  id: string;
  created_at: string | null;
  user_id: string | null;
  conversation_id: string | null;
  provider: string | null;
  model: string | null;
  analysis_mode: string | null;
  node_name: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number | null;
  success: boolean | null;
  outcome: string | null;
  error_code: string | null;
}

const DAY_OPTIONS = [1, 7, 30, 90];
const PAGE_SIZE = 50;

export const AIAuditLogTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('settings.ai_audit_log');
  const router = useRouter();
  const { currentOrganization } = useOrganizationStore();
  const [days, setDays] = useState(7);
  const [outcome, setOutcome] = useState<string | undefined>(undefined);
  const [nodeName, setNodeName] = useState<string | undefined>(undefined);
  const [nodeOptions, setNodeOptions] = useState<string[]>([]);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentOrganization?.id) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        organization_id: String(currentOrganization.id),
        days: String(days),
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });
      if (outcome) params.set('outcome', outcome);
      if (nodeName) params.set('node_name', nodeName);
      const res = await fetchApi(`ai/audit-log/llm-calls?${params.toString()}`);
      setRows(res?.items || []);
      setTotal(res?.total || 0);
    } catch (err) {
      console.error('[AIAuditLogTab]', err);
      setError(t('load_error'));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [currentOrganization?.id, days, outcome, nodeName, page, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Node filter options come from the server (distinct values actually seen)
  // rather than a hardcoded list, since node names change as the AI pipeline evolves.
  useEffect(() => {
    if (!currentOrganization?.id) return;
    const params = new URLSearchParams({ organization_id: String(currentOrganization.id), days: '30' });
    fetchApi(`ai/audit-log/llm-calls/nodes?${params.toString()}`)
      .then((res) => setNodeOptions(res?.nodes || []))
      .catch(() => setNodeOptions([]));
  }, [currentOrganization?.id]);

  // Filter changes reset to page 1 — otherwise a narrower result set can strand the view past its own last page.
  useEffect(() => {
    setPage(1);
  }, [days, outcome, nodeName]);

  useEffect(() => {
    onSetAction?.(
      <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
        {t('refresh')}
      </Button>
    );
  }, [loading, onSetAction, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(
    () => [
      {
        title: t('col_time'),
        dataIndex: 'created_at',
        key: 'created_at',
        width: 170,
        render: (v: string | null) => (v ? new Date(v).toLocaleString() : '—'),
      },
      {
        title: t('col_user'),
        dataIndex: 'user_id',
        key: 'user_id',
        width: 140,
        render: (v: string | null) => (v ? <Text code style={{ fontSize: 11 }}>{v.slice(0, 8)}</Text> : '—'),
      },
      {
        title: t('col_node'),
        dataIndex: 'node_name',
        key: 'node_name',
        width: 160,
        render: (v: string | null) => v || '—',
      },
      {
        title: t('col_mode'),
        dataIndex: 'analysis_mode',
        key: 'analysis_mode',
        width: 120,
        render: (v: string | null) => v || '—',
      },
      {
        title: t('col_model'),
        key: 'model',
        width: 200,
        render: (_: unknown, r: AuditLogRow) => (
          <span>
            {r.provider ? <Tag style={{ margin: 0, marginRight: 4 }}>{r.provider}</Tag> : null}
            <Text style={{ fontSize: 12 }}>{r.model || '—'}</Text>
          </span>
        ),
      },
      {
        title: t('col_tokens'),
        key: 'tokens',
        width: 110,
        render: (_: unknown, r: AuditLogRow) => (
          <Tooltip title={t('tokens_hint', { prompt: r.prompt_tokens, completion: r.completion_tokens })}>
            <span>{r.total_tokens}</span>
          </Tooltip>
        ),
      },
      {
        title: t('col_latency'),
        dataIndex: 'latency_ms',
        key: 'latency_ms',
        width: 100,
        render: (v: number | null) => (v != null ? `${(v / 1000).toFixed(1)}s` : '—'),
      },
      {
        title: t('col_outcome'),
        key: 'outcome',
        width: 130,
        render: (_: unknown, r: AuditLogRow) =>
          r.success === false || r.outcome === 'error' ? (
            <Tooltip title={r.error_code || undefined}>
              <Tag color="error">{r.error_code || t('outcome_error')}</Tag>
            </Tooltip>
          ) : (
            <Tag color="success">{t('outcome_success')}</Tag>
          ),
      },
      {
        title: '',
        key: 'actions',
        width: 90,
        render: (_: unknown, r: AuditLogRow) =>
          r.conversation_id ? (
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => router.push(`/chat?conversation=${encodeURIComponent(r.conversation_id!)}`)}
            >
              {t('open_conversation')}
            </Button>
          ) : null,
      },
    ],
    [t, router]
  );

  return (
    <PermissionGuard permission={Permission.AUDIT_VIEW} fallback={<Alert type="warning" message={t('no_permission')} showIcon />}>
      <Card size="small" variant="borderless" style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <Text type="secondary">{t('subtitle')}</Text>
          <Space wrap>
            <Select
              value={outcome}
              onChange={setOutcome}
              allowClear
              placeholder={t('filter_outcome')}
              style={{ width: 140 }}
              options={[
                { value: 'success', label: t('outcome_success') },
                { value: 'error', label: t('outcome_error') },
              ]}
            />
            <Select
              value={nodeName}
              onChange={setNodeName}
              allowClear
              placeholder={t('filter_node')}
              style={{ width: 180 }}
              options={nodeOptions.map((n) => ({ value: n, label: n }))}
            />
            <Select
              value={days}
              onChange={setDays}
              style={{ width: 150 }}
              aria-label={t('window_label')}
              options={DAY_OPTIONS.map((d) => ({ value: d, label: t('window_days', { days: d }) }))}
            />
          </Space>
        </div>

        {error ? <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon /> : null}

        {loading && rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : rows.length === 0 && !error ? (
          <Empty description={t('empty')} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            dataSource={rows}
            columns={columns}
            loading={loading}
            scroll={{ x: 1100 }}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              onChange: setPage,
              showSizeChanger: false,
              showTotal: (t_) => t('pagination_total', { count: t_ }),
            }}
          />
        )}
      </Card>
    </PermissionGuard>
  );
};

export default AIAuditLogTab;
