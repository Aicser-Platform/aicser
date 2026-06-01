'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, Table, Tag, Typography, Empty, Spin, Alert } from 'antd';
import { AuditOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useProjectStore } from '@/stores/useProjectStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/hooks/usePermissions';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import type { TabComponentProps } from '../page';

const { Title, Text } = Typography;

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

export const AuditLogTab: React.FC<TabComponentProps> = () => {
  const t = useTranslations('settings.audit');
  const { currentProject } = useProjectStore();
  const { currentOrganization } = useOrganizationStore();
  const { session } = useAuth();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAuditLogs = useCallback(async () => {
    if (!currentOrganization?.id && !currentProject?.id) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: '100',
        offset: '0',
      });
      if (currentProject?.id) {
        params.set('project_id', String(currentProject.id));
      }
      if (currentOrganization?.id) {
        params.set('organization_id', String(currentOrganization.id));
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const response = await fetch(`/api/platform/audit?${params.toString()}`, {
        credentials: 'include',
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const rows: AuditLogEntry[] = (data.entries || data.events || []).map((row: Record<string, unknown>) => ({
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
      }));
      setEntries(rows);
    } catch (err) {
      console.error('[AuditLogTab]', err);
      setError(t('load_error'));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [currentProject?.id, currentOrganization?.id, session?.access_token, t]);

  useEffect(() => {
    void fetchAuditLogs();
  }, [fetchAuditLogs]);

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
      <Card
        size="small"
        bordered={false}
        style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}
        title={
          <span>
            <AuditOutlined style={{ marginRight: 8 }} />
            {t('title')}
          </span>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          {t('subtitle')}
        </Text>

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
      </Card>
    </PermissionGuard>
  );
};

export default AuditLogTab;
