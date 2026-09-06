import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  ColorPicker,
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
  BgColorsOutlined,
  CodeOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { fetchApi, handleUpgradeRequiredError } from '@/utils/api';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/hooks/usePermissions';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useKnowledgeLibraries } from '@/hooks/useKnowledgeLibraries';
import { EmbedCodePanel } from '@/components/embed/EmbedCodePanel';
import { EmbedAssistantModal } from './embed/EmbedAssistantModal';
import { useEmbedCode } from '@/hooks/useEmbedCode';
import { buildEmbedChatUrl, pickPrimaryEmbedUrl } from '@/utils/embedSnippet';
import type { EmbedAssistantRecord } from '../types';
import type { TabComponentProps } from '../page';

const { Paragraph } = Typography;

type EmbedScope = 'dashboard' | 'chart' | 'chat';

export interface EmbedTheme {
  primary_color?: string | null;
  logo_url?: string | null;
  font_family?: string | null;
  mode?: 'light' | 'dark' | 'auto' | null;
  hide_aicser_branding?: boolean;
}

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
  theme?: EmbedTheme | null;
}

interface EmbedTokenCreated extends EmbedTokenRecord {
  token: string;
  embed_urls?: Record<string, string>;
}

// Chart scope now works end-to-end: GET /charts/embed/{id} previously
// queried a `widgets` table with `config`/`settings` columns that don't
// exist (real charts live in the `charts` table, `chart_query`/
// `chart_options`) and checked a `widget.settings.embed_token` that nothing
// ever wrote — it 500'd on every single request. Rewritten to query the
// real table and verify through this same JWT embed-token system (the one
// this form mints), so re-enabled here.
//
// Chat scope on *this* generic token is genuinely dead: the chat-embed page
// requires a full authenticated session (a different JWT secret than embed
// tokens use), so a token minted with this scope silently does nothing when
// used. It used to be listed here as "Chat (coming soon)", which read as
// "chat embedding doesn't exist yet" — misleading, since it does: the Embed
// Assistants card below this form is the real, working chat-embed path (its
// own embed_jwt/anonymous token system, unrelated to this one). Rather than
// keep a perpetually-disabled option pointing at a mechanism that was never
// going to be finished, "chat" is dropped from this checklist entirely so
// there's one obvious way to embed chat, not two — one broken, one not.
const SCOPE_OPTIONS: { label: string; value: EmbedScope; disabled?: boolean }[] = [
  { label: 'Dashboard', value: 'dashboard' },
  { label: 'Chart', value: 'chart' },
];

export const EmbedTab: React.FC<TabComponentProps> = () => {
  const t = useTranslations('settings');
  const tEmbed = useTranslations('embed_modal');
  const orgId = useOrganizationStore((s) => s.currentOrganization?.id);
  const [form] = Form.useForm();
  const [editThemeForm] = Form.useForm();
  const { embedAssistants, embedAssistantsLoading, loadEmbedAssistants } = useSettingsStore();
  const [tokens, setTokens] = useState<EmbedTokenRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [assistantModalOpen, setAssistantModalOpen] = useState(false);
  const [assistantModalMode, setAssistantModalMode] = useState<'create' | 'edit'>('create');
  const [editingAssistant, setEditingAssistant] = useState<EmbedAssistantRecord | null>(null);
  const [createdToken, setCreatedToken] = useState<EmbedTokenCreated | null>(null);
  const [editingThemeToken, setEditingThemeToken] = useState<EmbedTokenRecord | null>(null);
  const [savingTheme, setSavingTheme] = useState(false);
  const [assistantEmbed, setAssistantEmbed] = useState<{
    name: string;
    embedUrl: string;
    token?: string;
  } | null>(null);
  const [assistantEmbedLoading, setAssistantEmbedLoading] = useState(false);
  const [selectedEmbedScope, setSelectedEmbedScope] = useState<string>('dashboard');
  const { createEmbedCode } = useEmbedCode();

  const { libraries } = useKnowledgeLibraries(orgId);

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

  useEffect(() => {
    if (orgId) void loadEmbedAssistants(orgId);
  }, [orgId, loadEmbedAssistants]);

  const openCreateAssistant = () => {
    setEditingAssistant(null);
    setAssistantModalMode('create');
    setAssistantModalOpen(true);
  };

  const openEditAssistant = (assistant: EmbedAssistantRecord) => {
    setEditingAssistant(assistant);
    setAssistantModalMode('edit');
    setAssistantModalOpen(true);
  };

  const handleCreate = async (values: {
    name: string;
    scopes: EmbedScope[];
    resource_id?: string;
    allowed_domains?: string;
    expires_in_hours?: number;
    theme_primary_color?: { toHexString: () => string } | string;
    theme_logo_url?: string;
    theme_font_family?: string;
    theme_mode?: 'light' | 'dark' | 'auto';
    theme_hide_branding?: boolean;
  }) => {
    setCreating(true);
    try {
      const domains = (values.allowed_domains || '')
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      const primaryColor =
        typeof values.theme_primary_color === 'object' && values.theme_primary_color
          ? values.theme_primary_color.toHexString()
          : values.theme_primary_color;
      const theme: EmbedTheme | undefined =
        primaryColor || values.theme_logo_url || values.theme_font_family || values.theme_mode || values.theme_hide_branding
          ? {
              primary_color: primaryColor || undefined,
              logo_url: values.theme_logo_url || undefined,
              font_family: values.theme_font_family || undefined,
              mode: values.theme_mode || undefined,
              hide_aicser_branding: values.theme_hide_branding || false,
            }
          : undefined;
      const created = await fetchApi('/api/embed/tokens', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          scopes: values.scopes,
          resource_id: values.resource_id || undefined,
          allowed_domains: domains,
          expires_in_hours: values.expires_in_hours || 720,
          theme,
        }),
      });
      setShowCreateModal(false);
      form.resetFields();
      setCreatedToken(created);
      void loadTokens();
    } catch (err) {
      if (!handleUpgradeRequiredError(err)) {
        message.error(err instanceof Error ? err.message : t('embed_create_failed'));
      }
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

  const handleUpdateTheme = async (values: {
    theme_primary_color?: { toHexString: () => string } | string;
    theme_logo_url?: string;
    theme_font_family?: string;
    theme_mode?: 'light' | 'dark' | 'auto';
    theme_hide_branding?: boolean;
  }) => {
    if (!editingThemeToken) return;
    setSavingTheme(true);
    try {
      const primaryColor =
        typeof values.theme_primary_color === 'object' && values.theme_primary_color
          ? values.theme_primary_color.toHexString()
          : values.theme_primary_color;
      const theme: EmbedTheme = {
        primary_color: primaryColor || undefined,
        logo_url: values.theme_logo_url || undefined,
        font_family: values.theme_font_family || undefined,
        mode: values.theme_mode || undefined,
        hide_aicser_branding: values.theme_hide_branding || false,
      };
      await fetchApi(`/api/embed/tokens/${editingThemeToken.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ theme }),
      });
      message.success(t('embed_theme_updated'));
      setEditingThemeToken(null);
      editThemeForm.resetFields();
      void loadTokens();
    } catch (err) {
      if (!handleUpgradeRequiredError(err)) {
        message.error(err instanceof Error ? err.message : t('embed_theme_update_failed'));
      }
    } finally {
      setSavingTheme(false);
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
        <Space size={0}>
          <Button
            type="text"
            className="icon-only-btn"
            icon={<BgColorsOutlined />}
            title={t('embed_edit_theme')}
            aria-label={t('embed_edit_theme')}
            disabled={record.status !== 'active'}
            onClick={() => {
              setEditingThemeToken(record);
              editThemeForm.setFieldsValue({
                theme_primary_color: record.theme?.primary_color || undefined,
                theme_logo_url: record.theme?.logo_url || undefined,
                theme_font_family: record.theme?.font_family || undefined,
                theme_mode: record.theme?.mode || undefined,
                theme_hide_branding: record.theme?.hide_aicser_branding || false,
              });
            }}
          />
          <Popconfirm
            title={t('embed_revoke_confirm')}
            onConfirm={() => void handleRevoke(record.id)}
            okText={t('yes')}
            cancelText={t('no')}
          >
            <Button
              type="text"
              danger
              className="icon-only-btn"
              icon={<DeleteOutlined />}
              title={t('embed_revoke')}
              aria-label={t('embed_revoke')}
              disabled={record.status !== 'active'}
            />
          </Popconfirm>
        </Space>
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
      <div className="flex flex-col gap-5">
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t('embed_tab_desc')}
      </Paragraph>

      <Card
        size="small"
        title={t('embed_tokens_title')}
        variant="borderless"
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
        extra={
          <PermissionGuard permission={Permission.EMBED_CREATE}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateAssistant}>
              {t('embed_create_assistant')}
            </Button>
          </PermissionGuard>
        }
      >
        <Paragraph type="secondary">{t('embed_assistants_desc')}</Paragraph>
        <Table
          rowKey="id"
          size="small"
          loading={embedAssistantsLoading}
          dataSource={embedAssistants}
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
            {
              title: t('col_actions'),
              key: 'actions',
              render: (_, row) => (
                <Button
                  type="text"
                  className="icon-only-btn"
                  icon={<EditOutlined />}
                  title={t('embed_edit_assistant')}
                  aria-label={t('embed_edit_assistant')}
                  onClick={() => openEditAssistant(row)}
                />
              ),
            },
          ]}
        />
      </Card>
      </div>

      <EmbedAssistantModal
        open={assistantModalOpen}
        mode={assistantModalMode}
        organizationId={orgId}
        assistant={editingAssistant}
        onClose={() => setAssistantModalOpen(false)}
      />

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
          <Form.Item
            name="resource_id"
            label={t('embed_resource')}
            extra={t('embed_resource_help')}
            dependencies={['scopes']}
            rules={[
              {
                validator: async (_rule, value) => {
                  const scopes: string[] = form.getFieldValue('scopes') || [];
                  const needsResource = scopes.some((s) => ['dashboard', 'chart', 'report'].includes(s));
                  if (needsResource && !value) {
                    throw new Error(t('embed_resource_required'));
                  }
                },
              },
            ]}
          >
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
          <Collapse
            ghost
            style={{ marginBottom: 16 }}
            items={[
              {
                key: 'branding',
                label: t('embed_branding_section'),
                children: (
                  <>
                    <Form.Item
                      name="theme_primary_color"
                      label={t('embed_theme_primary_color')}
                      extra={t('embed_theme_primary_color_help')}
                    >
                      <ColorPicker format="hex" />
                    </Form.Item>
                    <Form.Item name="theme_logo_url" label={t('embed_theme_logo_url')}>
                      <Input placeholder="https://yourcompany.com/logo.png" />
                    </Form.Item>
                    <Form.Item name="theme_font_family" label={t('embed_theme_font_family')}>
                      <Input placeholder="'Inter', sans-serif" />
                    </Form.Item>
                    <Form.Item name="theme_mode" label={t('embed_theme_mode')}>
                      <Select
                        allowClear
                        placeholder={t('embed_theme_mode_auto_placeholder')}
                        options={[
                          { value: 'light', label: t('embed_theme_mode_light') },
                          { value: 'dark', label: t('embed_theme_mode_dark') },
                          { value: 'auto', label: t('embed_theme_mode_auto') },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name="theme_hide_branding" valuePropName="checked">
                      <Checkbox>{t('embed_theme_hide_branding')}</Checkbox>
                    </Form.Item>
                  </>
                ),
              },
            ]}
          />
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
        title={`${t('embed_edit_theme')}: ${editingThemeToken?.name || ''}`}
        open={!!editingThemeToken}
        onCancel={() => {
          setEditingThemeToken(null);
          editThemeForm.resetFields();
        }}
        footer={null}
        destroyOnHidden
      >
        <Form form={editThemeForm} layout="vertical" onFinish={(values) => void handleUpdateTheme(values)}>
          <Form.Item
            name="theme_primary_color"
            label={t('embed_theme_primary_color')}
            extra={t('embed_theme_primary_color_help')}
          >
            <ColorPicker format="hex" />
          </Form.Item>
          <Form.Item name="theme_logo_url" label={t('embed_theme_logo_url')}>
            <Input placeholder="https://yourcompany.com/logo.png" />
          </Form.Item>
          <Form.Item name="theme_font_family" label={t('embed_theme_font_family')}>
            <Input placeholder="'Inter', sans-serif" />
          </Form.Item>
          <Form.Item name="theme_mode" label={t('embed_theme_mode')}>
            <Select
              allowClear
              placeholder={t('embed_theme_mode_auto_placeholder')}
              options={[
                { value: 'light', label: t('embed_theme_mode_light') },
                { value: 'dark', label: t('embed_theme_mode_dark') },
                { value: 'auto', label: t('embed_theme_mode_auto') },
              ]}
            />
          </Form.Item>
          <Form.Item name="theme_hide_branding" valuePropName="checked">
            <Checkbox>{t('embed_theme_hide_branding')}</Checkbox>
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button
                onClick={() => {
                  setEditingThemeToken(null);
                  editThemeForm.resetFields();
                }}
              >
                {t('cancel')}
              </Button>
              <Button type="primary" htmlType="submit" loading={savingTheme}>
                {t('save')}
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
