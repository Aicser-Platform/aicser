import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CodeOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/hooks/usePermissions';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useKnowledgeLibraries } from '@/hooks/useKnowledgeLibraries';
import { EmbedCodePanel } from '@/components/embed/EmbedCodePanel';
import { useEmbedCode } from '@/hooks/useEmbedCode';
import { buildEmbedChatUrl, pickPrimaryEmbedUrl } from '@/utils/embedSnippet';
import type { TabComponentProps } from '../page';

const { Paragraph } = Typography;

type EmbedCapability = 'rag_only' | 'full_engine';

export interface EmbedAssistantRecord {
  id: string;
  name: string;
  capabilities: string;
  library_ids?: string[];
  allowed_modes?: string[];
  allowed_domains?: string[];
}

type EmbedScope = 'dashboard' | 'chart' | 'chat';

export interface EmbedTokenRecord {
  id: string;
  name: string;
  scopes: EmbedScope[];
  resource_id?: string | null;
  allowed_domains?: string[];
  created_at: string;
  expires_at: string;
  status: string;
  token_preview?: string;
}

interface EmbedTokenCreated extends EmbedTokenRecord {
  token: string;
  embed_urls?: Record<string, string>;
}

const SCOPE_OPTIONS: { label: string; value: EmbedScope }[] = [
  { label: 'Dashboard', value: 'dashboard' },
  { label: 'Chart', value: 'chart' },
  { label: 'Chat (EE)', value: 'chat' },
];

export const EmbedTab: React.FC<TabComponentProps> = () => {
  const t = useTranslations('settings');
  const tEmbed = useTranslations('embed_modal');
  const orgId = useOrganizationStore((s) => s.currentOrganization?.id);
  const [form] = Form.useForm();
  const [assistantForm] = Form.useForm();
  const [assistants, setAssistants] = useState<EmbedAssistantRecord[]>([]);
  const [tokens, setTokens] = useState<EmbedTokenRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingAssistant, setCreatingAssistant] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssistantModal, setShowAssistantModal] = useState(false);
  const [createdToken, setCreatedToken] = useState<EmbedTokenCreated | null>(null);
  const [assistantEmbed, setAssistantEmbed] = useState<{
    name: string;
    embedUrl: string;
    token?: string;
  } | null>(null);
  const [assistantEmbedLoading, setAssistantEmbedLoading] = useState(false);
  const [selectedEmbedScope, setSelectedEmbedScope] = useState<string>('dashboard');
  const { createEmbedCode } = useEmbedCode();

  const { libraries, isLoading: librariesLoading } = useKnowledgeLibraries(orgId);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApi('/api/embed/tokens');
      setTokens(res.tokens || []);
    } catch {
      message.error(tEmbed('failed_load_embeds'));
    } finally {
      setLoading(false);
    }
  }, [tEmbed]);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const loadAssistants = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await fetchApi(
        `/api/embed/assistants?organization_id=${encodeURIComponent(String(orgId))}`,
      );
      setAssistants(res.assistants || []);
    } catch {
      setAssistants([]);
    }
  }, [orgId]);

  useEffect(() => {
    void loadAssistants();
  }, [loadAssistants]);

  const handleCreateAssistant = async (values: {
    name: string;
    capabilities: EmbedCapability;
    library_ids?: string[];
    allowed_modes?: string[];
    allowed_domains?: string;
  }) => {
    if (!orgId) return;
    setCreatingAssistant(true);
    try {
      const domains = (values.allowed_domains || '')
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      await fetchApi('/api/embed/assistants', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          organization_id: orgId,
          capabilities: values.capabilities,
          library_ids: values.library_ids || [],
          allowed_modes: values.allowed_modes?.length ? values.allowed_modes : ['ai_search'],
          allowed_domains: domains,
        }),
      });
      message.success(t('embed_assistant_created'));
      setShowAssistantModal(false);
      assistantForm.resetFields();
      void loadAssistants();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('embed_assistant_create_failed'));
    } finally {
      setCreatingAssistant(false);
    }
  };

  const handleCreate = async (values: {
    name: string;
    scopes: EmbedScope[];
    resource_id?: string;
    allowed_domains?: string;
    expires_in_hours?: number;
  }) => {
    setCreating(true);
    try {
      const domains = (values.allowed_domains || '')
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      const created = await fetchApi('/api/embed/tokens', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          scopes: values.scopes,
          resource_id: values.resource_id || undefined,
          allowed_domains: domains,
          expires_in_hours: values.expires_in_hours || 720,
        }),
      });
      setShowCreateModal(false);
      form.resetFields();
      setCreatedToken(created);
      void loadTokens();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('embed_create_failed'));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (tokenId: string) => {
    try {
      await fetchApi(`/api/embed/tokens/${tokenId}`, { method: 'DELETE' });
      message.success(tEmbed('embed_revoked'));
      void loadTokens();
    } catch {
      message.error(tEmbed('failed_revoke_embed'));
    }
  };

  const createdEmbedUrl = useMemo(() => {
    if (!createdToken?.embed_urls) return '';
    return (
      createdToken.embed_urls[selectedEmbedScope] || pickPrimaryEmbedUrl(createdToken.embed_urls)
    );
  }, [createdToken, selectedEmbedScope]);

  const embedScopeOptions = useMemo(() => {
    if (!createdToken?.embed_urls) return [];
    return Object.keys(createdToken.embed_urls).map((scope) => ({
      label: scope.charAt(0).toUpperCase() + scope.slice(1),
      value: scope,
    }));
  }, [createdToken]);

  useEffect(() => {
    if (embedScopeOptions.length > 0) {
      setSelectedEmbedScope(embedScopeOptions[0].value);
    }
  }, [embedScopeOptions]);

  const openAssistantEmbed = async (assistant: EmbedAssistantRecord) => {
    setAssistantEmbedLoading(true);
    setAssistantEmbed({ name: assistant.name, embedUrl: '' });
    try {
      const result = await createEmbedCode({
        scope: 'chat',
        name: `Assistant: ${assistant.name}`,
        assistantId: assistant.id,
      });
      setAssistantEmbed({
        name: assistant.name,
        embedUrl: result.embedUrl || buildEmbedChatUrl({ assistantId: assistant.id }),
        token: result.token,
      });
    } catch {
      setAssistantEmbed({
        name: assistant.name,
        embedUrl: buildEmbedChatUrl({ assistantId: assistant.id }),
      });
    } finally {
      setAssistantEmbedLoading(false);
    }
  };

  const columns = [
    { title: t('name'), dataIndex: 'name', key: 'name' },
    {
      title: t('embed_scopes'),
      dataIndex: 'scopes',
      key: 'scopes',
      render: (scopes: string[]) => (
        <Space wrap>
          {(scopes || []).map((scope) => (
            <Tag key={scope}>{scope}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('embed_resource'),
      dataIndex: 'resource_id',
      key: 'resource_id',
      render: (value: string | null) => value || '—',
    },
    {
      title: t('created_at'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (value: string) => (value ? new Date(value).toLocaleString() : '—'),
    },
    {
      title: t('status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>{status?.toUpperCase()}</Tag>
      ),
    },
    {
      title: t('col_actions'),
      key: 'actions',
      render: (_: unknown, record: EmbedTokenRecord) => (
        <Popconfirm
          title={t('embed_revoke_confirm')}
          onConfirm={() => void handleRevoke(record.id)}
          okText={t('yes')}
          cancelText={t('no')}
        >
          <Button type="text" danger icon={<DeleteOutlined />} disabled={record.status !== 'active'} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <PermissionGuard
      permission={[Permission.EMBED_CREATE, Permission.EMBED_VIEW]}
      fallback={
        <Alert
          type="warning"
          showIcon
          message={t('embed_no_permission')}
          description={t('embed_no_permission_desc')}
        />
      }
    >
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t('embed_tab_desc')}
      </Paragraph>

      <Card
        size="small"
        title={t('embed_tokens_title')}
        bordered={false}
        style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}
        extra={
          <PermissionGuard permission={Permission.EMBED_CREATE}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowCreateModal(true)}>
              {t('embed_create_token')}
            </Button>
          </PermissionGuard>
        }
      >
        <Table
          rowKey="id"
          loading={loading}
          dataSource={tokens}
          columns={columns}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 'max-content' }}
        />
      </Card>

      <Card
        size="small"
        title={t('embed_assistants_title')}
        style={{ marginTop: 16 }}
        extra={
          <PermissionGuard permission={Permission.EMBED_CREATE}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowAssistantModal(true)}>
              {t('embed_create_assistant')}
            </Button>
          </PermissionGuard>
        }
      >
        <Paragraph type="secondary">{t('embed_assistants_desc')}</Paragraph>
        <Table
          rowKey="id"
          size="small"
          dataSource={assistants}
          pagination={false}
          locale={{ emptyText: t('embed_assistants_empty') }}
          columns={[
            { title: t('embed_assistant_name'), dataIndex: 'name', key: 'name' },
            { title: t('embed_assistant_capabilities'), dataIndex: 'capabilities', key: 'capabilities' },
            {
              title: t('embed_assistant_libraries'),
              dataIndex: 'library_ids',
              key: 'library_ids',
              render: (ids: string[] | undefined) =>
                ids?.length ? (
                  <Space wrap size={[4, 4]}>
                    {ids.map((id) => (
                      <Tag key={id}>{libraries.find((l) => l.id === id)?.name || id.slice(0, 8)}</Tag>
                    ))}
                  </Space>
                ) : (
                  '—'
                ),
            },
            {
              title: t('embed_assistant_url'),
              key: 'url',
              render: (_, row) => (
                <Button type="link" size="small" icon={<CodeOutlined />} onClick={() => void openAssistantEmbed(row)}>
                  {tEmbed('embed_get_code')}
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={t('embed_create_assistant')}
        open={showAssistantModal}
        onCancel={() => {
          setShowAssistantModal(false);
          assistantForm.resetFields();
        }}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={assistantForm}
          layout="vertical"
          initialValues={{ capabilities: 'rag_only', allowed_modes: ['ai_search'] }}
          onFinish={(values) => void handleCreateAssistant(values)}
        >
          <Form.Item name="name" label={t('embed_assistant_name')} rules={[{ required: true, message: t('embed_name_required') }]}>
            <Input placeholder={t('embed_assistant_name')} />
          </Form.Item>
          <Form.Item name="capabilities" label={t('embed_assistant_capabilities')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'rag_only', label: t('embed_assistant_cap_rag') },
                { value: 'full_engine', label: t('embed_assistant_cap_full') },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="library_ids"
            label={t('embed_assistant_libraries')}
            extra={t('embed_assistant_libraries_help')}
          >
            <Select
              mode="multiple"
              loading={librariesLoading}
              placeholder={t('embed_assistant_libraries')}
              options={libraries.map((lib) => ({ value: lib.id, label: lib.name }))}
              allowClear
            />
          </Form.Item>
          <Form.Item name="allowed_modes" label={t('embed_assistant_modes')}>
            <Select
              mode="multiple"
              options={[
                { value: 'ai_search', label: 'AI Search' },
                { value: 'standard', label: 'Standard' },
                { value: 'deep', label: 'Deep analysis' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="allowed_domains"
            label={t('embed_assistant_domains')}
            extra={t('embed_assistant_domains_help')}
          >
            <Input placeholder="intranet.example.com, teams.microsoft.com" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button onClick={() => setShowAssistantModal(false)}>{t('cancel')}</Button>
              <Button type="primary" htmlType="submit" loading={creatingAssistant}>
                {t('create_key')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('embed_create_token')}
        open={showCreateModal}
        onCancel={() => {
          setShowCreateModal(false);
          form.resetFields();
        }}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ scopes: ['dashboard'], expires_in_hours: 720 }}
          onFinish={(values) => void handleCreate(values)}
        >
          <Form.Item name="name" label={t('name')} rules={[{ required: true, message: t('embed_name_required') }]}>
            <Input placeholder={t('embed_name_placeholder')} />
          </Form.Item>
          <Form.Item name="scopes" label={t('embed_scopes')} rules={[{ required: true, message: t('embed_scopes_required') }]}>
            <Checkbox.Group options={SCOPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="resource_id" label={t('embed_resource')} extra={t('embed_resource_help')}>
            <Input placeholder={t('embed_resource_placeholder')} />
          </Form.Item>
          <Form.Item name="allowed_domains" label={t('embed_allowed_domains')} extra={t('embed_allowed_domains_help')}>
            <Input placeholder="example.com, teams.microsoft.com" />
          </Form.Item>
          <Form.Item name="expires_in_hours" label={t('embed_expires_hours')}>
            <Select
              options={[
                { value: 24, label: '24 hours' },
                { value: 168, label: '7 days' },
                { value: 720, label: '30 days' },
                { value: 8760, label: '1 year' },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button onClick={() => setShowCreateModal(false)}>{t('cancel')}</Button>
              <Button type="primary" htmlType="submit" loading={creating}>
                {t('create_key')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('embed_token_created_title')}
        open={!!createdToken}
        onCancel={() => setCreatedToken(null)}
        width={720}
        footer={[
          <Button key="done" type="primary" onClick={() => setCreatedToken(null)}>
            {t('done')}
          </Button>,
        ]}
      >
        {createdToken ? (
          <>
            <Alert type="warning" message={t('api_key_store_securely')} style={{ marginBottom: 16 }} />
            {embedScopeOptions.length > 1 ? (
              <Select
                style={{ width: '100%', marginBottom: 12 }}
                value={selectedEmbedScope}
                onChange={setSelectedEmbedScope}
                options={embedScopeOptions}
              />
            ) : null}
            <EmbedCodePanel
              embedUrl={createdEmbedUrl}
              token={createdToken.token}
              title={createdToken.name}
              iframeHeight={420}
            />
          </>
        ) : null}
      </Modal>

      <Modal
        title={`${tEmbed('embed_get_code')}: ${assistantEmbed?.name || ''}`}
        open={!!assistantEmbed}
        onCancel={() => setAssistantEmbed(null)}
        width={720}
        footer={null}
        destroyOnHidden
      >
        <EmbedCodePanel
          embedUrl={assistantEmbed?.embedUrl || ''}
          loading={assistantEmbedLoading}
          token={assistantEmbed?.token}
          title={assistantEmbed?.name}
          iframeHeight={420}
          hint={tEmbed('embed_assistant_hint')}
        />
      </Modal>
    </PermissionGuard>
  );
};
