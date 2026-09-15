'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Table, Tag, Typography, Empty, Spin, Alert, Descriptions, Select, Space, message } from 'antd';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useProjectStore } from '@/stores/useProjectStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/hooks/usePermissions';
import { fetchApi, fetchApiBlob, handleUpgradeRequiredError } from '@/utils/api';
import type { TabComponentProps } from '../page';

const { Title, Text, Paragraph } = Typography;

/** True when an entry has anything worth expanding a row for — resource
 * reference or metadata beyond an empty object. Avoids showing an expand
 * chevron on rows with nothing behind it. */
function hasExpandableDetail(entry: AuditLogEntry): boolean {
  return Boolean(
    entry.resourceType ||
      entry.resourceId ||
      entry.orgId ||
      (entry.metadata && Object.keys(entry.metadata).length > 0)
  );
}

export interface AuditLogEntry {
  id: string;
  eventType?: string;
  category?: string;
  userId?: string | null;
  orgId?: string | null;
  action?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  createdAt?: string | null;
  metadata?: Record<string, unknown>;
}

// Server page size — also doubles as the "there might be more" signal: a full
// page back means there could be another one, matching the backend's own
// `limit`/`offset` pagination (server/ee/modules/platform/router.py's /audit).
const PAGE_SIZE = 100;

// Same categories AuditLogTab already colors via categoryColor() below —
// kept as the filter's option list too, so filtering never offers a category
// the table itself wouldn't render distinctly.
const FILTERABLE_CATEGORIES = ['auth', 'ai', 'data', 'admin', 'billing'];

function mapAuditRow(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: String(row.id),
    eventType: (row.event_type ?? row.eventType) as string | undefined,
    category: row.category as string | undefined,
    userId: (row.user_id ?? row.userId ?? row.actorUserId) as string | null | undefined,
    orgId: (row.org_id ?? row.orgId) as string | null | undefined,
    action: row.action as string | null | undefined,
    resourceType: (row.resource_type ?? row.resourceType) as string | null | undefined,
    resourceId: (row.resource_id ?? row.resourceId) as string | null | undefined,
    statusCode: (row.status_code ?? row.statusCode) as number | null | undefined,
    durationMs: (row.duration_ms ?? row.durationMs) as number | null | undefined,
    createdAt: (row.created_at ?? row.createdAt) as string | null | undefined,
    metadata: (row.metadata as Record<string, unknown>) || {},
  };
}

export const AuditLogTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('settings.audit');
  const { currentProject } = useProjectStore();
  const { currentOrganization } = useOrganizationStore();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  const buildParams = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (currentProject?.id) params.set('project_id', String(currentProject.id));
      if (currentOrganization?.id) params.set('organization_id', String(currentOrganization.id));
      if (categoryFilter) params.set('category', categoryFilter);
      return params;
    },
    [currentProject?.id, currentOrganization?.id, categoryFilter]
  );

  // Resets to the first page — used on mount, on Refresh, and whenever the
  // category filter changes (a new filter means the old offset no longer
  // means the same thing).
  const fetchAuditLogs = useCallback(async () => {
    if (!currentOrganization?.id && !currentProject?.id) return;
    setLoading(true);
    setError(null);
    try {
      // fetchApi centralizes CE/EE auth-token resolution and org-header
      // injection — hand-rolling `Authorization: Bearer session.access_token`
      // here duplicated (and fell behind) that logic.
      const data = await fetchApi(`platform/audit?${buildParams(0).toString()}`);
      const rows: AuditLogEntry[] = (data.entries || data.events || []).map(mapAuditRow);
      setEntries(rows);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      console.error('[AuditLogTab]', err);
      if (!handleUpgradeRequiredError(err)) {
        setError(t('load_error'));
      }
      setEntries([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [currentProject?.id, currentOrganization?.id, buildParams, t]);

  // Appends the next server page onto what's already loaded — the table's own
  // pagination continues to page through the growing local array 20 at a time.
  const loadMore = useCallback(async () => {
    if (!currentOrganization?.id && !currentProject?.id) return;
    setLoadingMore(true);
    try {
      const data = await fetchApi(`platform/audit?${buildParams(entries.length).toString()}`);
      const rows: AuditLogEntry[] = (data.entries || data.events || []).map(mapAuditRow);
      setEntries((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      console.error('[AuditLogTab]', err);
      if (!handleUpgradeRequiredError(err)) {
        setError(t('load_error'));
      }
    } finally {
      setLoadingMore(false);
    }
  }, [currentProject?.id, currentOrganization?.id, buildParams, entries.length, t]);

  useEffect(() => {
    void fetchAuditLogs();
  }, [fetchAuditLogs]);

  // Compliance/audit teams need a file they can hand to an auditor or feed
  // into a SIEM, not just a scrollable table — the read endpoint caps at
  // 200 rows/page with no bulk path at all. Same auth + Content-Disposition
  // filename handling every other file export in this app already uses
  // (fetchApiBlob), pointed at the new streaming CSV endpoint.
  const handleExport = useCallback(async () => {
    if (!currentOrganization?.id && !currentProject?.id) return;
    setExporting(true);
    try {
      const { blob, filename } = await fetchApiBlob(
        `platform/audit/export?${buildParams(0).toString()}`
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || 'audit-log.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error('[AuditLogTab] export failed', err);
      message.error(t('export_error'));
    } finally {
      setExporting(false);
    }
  }, [currentOrganization?.id, currentProject?.id, buildParams, t]);

  useEffect(() => {
    onSetAction?.(
      <Space>
        <Button icon={<DownloadOutlined />} onClick={() => void handleExport()} loading={exporting}>
          {t('export_csv')}
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => void fetchAuditLogs()} loading={loading}>
          {t('refresh')}
        </Button>
      </Space>
    );
  }, [loading, exporting, onSetAction, fetchAuditLogs, handleExport]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderExpandedDetail = (entry: AuditLogEntry) => {
    const metadataEntries = Object.entries(entry.metadata || {});
    return (
      <div style={{ padding: '4px 8px' }}>
        {(entry.resourceType || entry.resourceId || entry.orgId) && (
          <Descriptions size="small" column={1} style={{ marginBottom: metadataEntries.length ? 12 : 0 }}>
            {entry.resourceType && (
              <Descriptions.Item label={t('details_resource')}>
                {entry.resourceType}
                {entry.resourceId ? ` · ${entry.resourceId}` : ''}
              </Descriptions.Item>
            )}
            {entry.orgId && <Descriptions.Item label={t('details_org')}>{entry.orgId}</Descriptions.Item>}
          </Descriptions>
        )}
        {metadataEntries.length > 0 && (
          <div>
            <Text strong style={{ fontSize: 12 }}>
              {t('details_metadata')}
            </Text>
            <Paragraph copyable={{ text: JSON.stringify(entry.metadata, null, 2) }} style={{ marginBottom: 0, marginTop: 4 }}>
              <Text code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block', maxHeight: 260, overflow: 'auto' }}>
                {JSON.stringify(entry.metadata, null, 2)}
              </Text>
            </Paragraph>
          </div>
        )}
        {!entry.resourceType && !entry.resourceId && !entry.orgId && metadataEntries.length === 0 && (
          <Text type="secondary">{t('details_none')}</Text>
        )}
      </div>
    );
  };

  const categoryColor = (category?: string) => {
    switch ((category || '').toLowerCase()) {
      case 'auth':
        return 'purple';
      case 'ai':
        return 'blue';
      case 'data':
        return 'green';
      case 'admin':
        return 'orange';
      case 'billing':
        return 'gold';
      default:
        return 'default';
    }
  };

  return (
    <PermissionGuard permission={Permission.AUDIT_VIEW} fallback={<Alert type="warning" message={t('no_permission')} showIcon />}>
      <Card size="small" variant="borderless" style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          {t('subtitle')}
        </Text>

        <Select
          allowClear
          placeholder={t('filter_category_all')}
          value={categoryFilter}
          onChange={(v) => setCategoryFilter(v)}
          style={{ width: 200, marginBottom: 16 }}
          aria-label={t('filter_category_label')}
          options={FILTERABLE_CATEGORIES.map((c) => ({ value: c, label: c }))}
        />

        {error ? <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon /> : null}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : entries.length === 0 ? (
          <Empty description={t('empty')} />
        ) : (
          <Table
            size="small"
            rowKey="id"
            pagination={{ pageSize: 20, showSizeChanger: false }}
            dataSource={entries}
            scroll={{ x: true }}
            expandable={{
              expandedRowRender: renderExpandedDetail,
              rowExpandable: hasExpandableDetail,
            }}
            columns={[
              {
                title: t('col_time'),
                dataIndex: 'createdAt',
                key: 'createdAt',
                width: 180,
                render: (v: string) => (v ? new Date(v).toLocaleString() : '—'),
              },
              {
                title: t('col_category'),
                dataIndex: 'category',
                key: 'category',
                width: 100,
                render: (v: string) => <Tag color={categoryColor(v)}>{v || 'api'}</Tag>,
              },
              {
                title: t('col_event'),
                dataIndex: 'eventType',
                key: 'eventType',
                width: 160,
                ellipsis: true,
              },
              {
                title: t('col_action'),
                dataIndex: 'action',
                key: 'action',
                ellipsis: true,
              },
              {
                title: t('col_user'),
                dataIndex: 'userId',
                key: 'userId',
                width: 120,
                ellipsis: true,
                render: (v: string) => v || '—',
              },
              {
                title: t('col_status'),
                dataIndex: 'statusCode',
                key: 'statusCode',
                width: 80,
                render: (v: number) =>
                  v != null ? (
                    <Tag color={v >= 400 ? 'error' : v >= 300 ? 'warning' : 'success'}>{v}</Tag>
                  ) : (
                    '—'
                  ),
              },
              {
                title: t('col_duration'),
                dataIndex: 'durationMs',
                key: 'durationMs',
                width: 90,
                render: (v: number) => (v != null ? `${v}ms` : '—'),
              },
            ]}
          />
        )}

        {!loading && hasMore && entries.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Button onClick={() => void loadMore()} loading={loadingMore}>
              {t('load_more')}
            </Button>
          </div>
        )}
      </Card>
    </PermissionGuard>
  );
};

export default AuditLogTab;
