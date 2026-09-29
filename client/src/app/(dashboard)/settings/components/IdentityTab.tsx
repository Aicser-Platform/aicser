'use client';

/**
 * Identity (SCIM): connect the organization's identity provider (Okta, Microsoft Entra ID,
 * OneLogin, JumpCloud, Google Workspace) so people and groups are provisioned and removed
 * automatically, and map directory groups to organization roles.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, App, Button, Card, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { fetchApi } from '@/utils/api';
import { getBackendUrl } from '@/utils/backendUrl';
import type { TabComponentProps } from '../page';

const { Text, Paragraph } = Typography;

interface ScimTokenRow {
  id: string;
  name: string;
  hint: string;
  created_at: string | null;
  last_used_at: string | null;
  status: 'active' | 'revoked';
}

interface DirectoryGroup {
  id: string;
  name: string;
  role: string | null;
  members: number;
  source?: string;
}

interface SsoStatus {
  provider: string;
  keycloak: { configured: boolean; host: string | null; realm: string | null; client_id: string | null };
  groups_by_source: Record<string, number>;
}

const ROLES = ['org_admin', 'org_member', 'org_viewer'];

export default function IdentityTab(_: TabComponentProps) {
  const t = useTranslations('settings.identity');
  const { message } = App.useApp();
  const [tokens, setTokens] = useState<ScimTokenRow[]>([]);
  const [groups, setGroups] = useState<DirectoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [sso, setSso] = useState<SsoStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tk, gr] = await Promise.all([
        fetchApi<{ tokens: ScimTokenRow[] }>('api/scim/tokens'),
        fetchApi<{ groups: DirectoryGroup[] }>('api/scim/groups'),
      ]);
      setTokens(tk.tokens || []);
      setGroups(gr.groups || []);
      fetchApi<SsoStatus>('api/scim/sso-status').then(setSso).catch(() => setSso(null));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    load();
  }, [load]);

  const createToken = async () => {
    try {
      const res = await fetchApi<{ token: string }>('api/scim/tokens', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() || t('default_token_name') }),
        headers: { 'Content-Type': 'application/json' },
      });
      setCreatedToken(res.token);
      setName('');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const revoke = (row: ScimTokenRow) =>
    Modal.confirm({
      title: t('revoke_confirm', { name: row.name }),
      content: t('revoke_confirm_desc'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await fetchApi(`api/scim/tokens/${row.id}`, { method: 'DELETE' });
          message.success(t('revoked'));
          load();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });

  const setRole = async (group: DirectoryGroup, role: string | null) => {
    try {
      await fetchApi(`api/scim/groups/${group.id}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
        headers: { 'Content-Type': 'application/json' },
      });
      setGroups((gs) => gs.map((g) => (g.id === group.id ? { ...g, role } : g)));
      message.success(t('role_saved'));
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const isKeycloak = sso?.provider === 'keycloak';
  const keycloakGroups = sso?.groups_by_source?.keycloak ?? 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* How people sign in, and how groups arrive. Keycloak sends groups in the sign-in
          token (no SCIM); Okta / Entra and similar push them over SCIM (below). */}
      <Card size="small" title={t('sso_title')}>
        {sso ? (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Text>
              {t('sso_provider')}{' '}
              <Tag color="blue">{isKeycloak ? 'Keycloak' : sso.provider === 'supabase' ? 'Supabase' : sso.provider}</Tag>
              {isKeycloak && sso.keycloak.host ? (
                <Text type="secondary">
                  {sso.keycloak.host}
                  {sso.keycloak.realm ? ` · ${t('sso_realm')} ${sso.keycloak.realm}` : ''}
                </Text>
              ) : null}
            </Text>
            {isKeycloak ? (
              <>
                <Text>
                  {keycloakGroups > 0
                    ? t('sso_keycloak_groups_on', { count: keycloakGroups })
                    : t('sso_keycloak_groups_waiting')}
                </Text>
                <Paragraph type="secondary" style={{ margin: 0 }}>
                  {t('sso_keycloak_setup', { client: sso.keycloak.client_id || 'aiser' })}
                </Paragraph>
              </>
            ) : (
              <Paragraph type="secondary" style={{ margin: 0 }}>
                {t('sso_non_keycloak')}
              </Paragraph>
            )}
          </Space>
        ) : (
          <Text type="secondary">{t('sso_unknown')}</Text>
        )}
      </Card>

      <Card size="small" title={t('connect_title')}>
        <Paragraph type="secondary">{t('connect_desc')}</Paragraph>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>
            {t('base_url')}{' '}
            {/* The app's own public address: it forwards /api/* to the server. The build-time
                backend URL is often an internal host an identity provider can't reach. */}
            <Text code copyable>{`${typeof window !== 'undefined' ? window.location.origin : getBackendUrl()}/api/scim/v2`}</Text>
          </Text>
          <Space.Compact style={{ maxWidth: 480, width: '100%' }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('token_name_ph')} maxLength={128} />
            <Button type="primary" icon={<PlusOutlined />} onClick={createToken}>
              {t('create_token')}
            </Button>
          </Space.Compact>
        </Space>
        <Table
          size="small"
          style={{ marginTop: 12 }}
          rowKey="id"
          loading={loading}
          dataSource={tokens}
          pagination={false}
          locale={{ emptyText: t('no_tokens') }}
          columns={[
            { title: t('col_name'), dataIndex: 'name' },
            { title: t('col_token'), dataIndex: 'hint', render: (v: string) => <Text code>{v}</Text> },
            {
              title: t('col_last_used'),
              dataIndex: 'last_used_at',
              render: (v: string | null) => (v ? new Date(v).toLocaleString() : t('never')),
            },
            {
              title: t('col_status'),
              dataIndex: 'status',
              render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{t(`status_${v}`)}</Tag>,
            },
            {
              key: 'actions',
              render: (_: unknown, r: ScimTokenRow) =>
                r.status === 'active' ? (
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => revoke(r)}>
                    {t('revoke')}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>

      <Card size="small" title={t('groups_title')}>
        <Paragraph type="secondary">{t('groups_desc')}</Paragraph>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={groups}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: t('no_groups') }}
          columns={[
            {
              title: t('col_group'),
              dataIndex: 'name',
              render: (v: string, g: DirectoryGroup) => (
                <Space size={6}>
                  <span>{v}</span>
                  <Tag>{t(`source_${['keycloak', 'scim', 'manual'].includes(g.source || '') ? g.source : 'scim'}` as never)}</Tag>
                </Space>
              ),
            },
            { title: t('col_members'), dataIndex: 'members', align: 'right' },
            {
              title: t('col_role'),
              dataIndex: 'role',
              render: (v: string | null, g: DirectoryGroup) => (
                <Select
                  size="small"
                  style={{ width: 200 }}
                  value={v ?? '__none__'}
                  onChange={(val: string) => setRole(g, val === '__none__' ? null : val)}
                  options={[
                    { value: '__none__', label: t('role_none') },
                    ...ROLES.map((r) => ({ value: r, label: t(`role_${r}`) })),
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={!!createdToken}
        title={t('token_created_title')}
        onCancel={() => setCreatedToken(null)}
        footer={<Button type="primary" onClick={() => setCreatedToken(null)}>{t('done')}</Button>}
      >
        <Alert type="warning" showIcon message={t('token_once')} style={{ marginBottom: 12 }} />
        <Text code copyable style={{ wordBreak: 'break-all' }}>
          {createdToken}
        </Text>
      </Modal>
    </Space>
  );
}
