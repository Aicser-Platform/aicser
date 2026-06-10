import React, { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Card,
  Form,
  Button,
  message,
  Space,
  Table,
  Tag,
  Popconfirm,
  Modal,
  Input,
  Tabs,
  Typography,
  Divider,
  Alert,
  Select,
} from 'antd';
import {
  KeyOutlined,
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { getAiProviderLogo } from '@/config/aiProviders';
import type { ApiKey } from '../types';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';

const ModelSelector = dynamic(
  () => import('@/components/ai/ModelSelector/ModelSelector').then((m) => m.ModelSelector),
  { ssr: false }
);

const { Text } = Typography;

/** Predefined model IDs per AI provider — aligned with LLM Stats & LiteLLM (latest). Default: gpt-4.1-mini. */
type ProviderModelDef = {
  value: string;
  labelKey: string;
  suffix?: 'default' | 'latest';
};

const OPENAI_AZURE_MODEL_DEFS: ProviderModelDef[] = [
  { value: 'gpt-4.1-mini', labelKey: 'ai_model_gpt_4_1_mini', suffix: 'default' },
  { value: 'gpt-5', labelKey: 'ai_model_gpt_5' },
  { value: 'gpt-5-mini', labelKey: 'ai_model_gpt_5_mini' },
  { value: 'gpt-5-nano', labelKey: 'ai_model_gpt_5_nano' },
  { value: 'gpt-5.2', labelKey: 'ai_model_gpt_5_2' },
  { value: 'gpt-5.1', labelKey: 'ai_model_gpt_5_1' },
  { value: 'gpt-4.1', labelKey: 'ai_model_gpt_4_1' },
  { value: 'gpt-4.1-nano', labelKey: 'ai_model_gpt_4_1_nano' },
  { value: 'o1-mini', labelKey: 'ai_model_o1_mini' },
  { value: 'gpt-4o-mini', labelKey: 'ai_model_gpt_4o_mini' },
  { value: 'gpt-4', labelKey: 'ai_model_gpt_4' },
  { value: 'gpt-5.1-codex-mini', labelKey: 'ai_model_gpt_5_1_codex_mini' },
];

const PROVIDER_MODEL_DEFS: Record<string, ProviderModelDef[]> = {
  openai: OPENAI_AZURE_MODEL_DEFS,
  azure_openai: OPENAI_AZURE_MODEL_DEFS,
  anthropic: [
    { value: 'claude-3-7-sonnet-20250219', labelKey: 'ai_model_claude_3_7_sonnet' },
    { value: 'claude-3-5-sonnet-20240620', labelKey: 'ai_model_claude_3_5_sonnet' },
    { value: 'claude-3-haiku-20240307', labelKey: 'ai_model_claude_3_haiku' },
  ],
  google: [
    { value: 'gemini-3.1-pro-preview', labelKey: 'ai_model_gemini_3_1_pro_preview' },
    { value: 'gemini-3-flash-preview', labelKey: 'ai_model_gemini_3_flash_preview' },
    { value: 'gemini-2.5-pro', labelKey: 'ai_model_gemini_2_5_pro' },
    { value: 'gemini-2.5-flash', labelKey: 'ai_model_gemini_2_5_flash' },
    { value: 'gemini-2.0-flash', labelKey: 'ai_model_gemini_2_0_flash' },
    { value: 'gemini-flash-lite-latest', labelKey: 'ai_model_gemini_flash_lite', suffix: 'latest' },
    { value: 'gemini-1.5-pro', labelKey: 'ai_model_gemini_1_5_pro' },
    { value: 'gemini-1.5-flash', labelKey: 'ai_model_gemini_1_5_flash' },
  ],
};

function buildProviderModelLabel(
  translate: (key: string) => string,
  def: ProviderModelDef
): string {
  const base = translate(def.labelKey);
  if (def.suffix === 'default') return `${base}${translate('ai_model_default_suffix')}`;
  if (def.suffix === 'latest') return `${base}${translate('ai_model_latest_suffix')}`;
  return base;
}

const PROVIDER_I18N_KEYS: Record<string, { nameKey: string; descKey: string }> = {
  openai: { nameKey: 'api_keys_provider_name_openai', descKey: 'api_keys_provider_desc_openai' },
  anthropic: { nameKey: 'api_keys_provider_name_anthropic', descKey: 'api_keys_provider_desc_anthropic' },
  azure_openai: { nameKey: 'api_keys_provider_name_azure', descKey: 'api_keys_provider_desc_azure' },
  google: { nameKey: 'api_keys_provider_name_google', descKey: 'api_keys_provider_desc_google' },
  ollama: { nameKey: 'api_keys_provider_name_ollama', descKey: 'api_keys_provider_desc_ollama' },
};

const PROVIDER_CARD_ORDER = ['openai', 'anthropic', 'azure_openai', 'google', 'ollama'] as const;

import type { TabComponentProps } from '../page';

export const ApiKeysTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('settings');
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiSubTabKeys = ['platform', 'providers', 'ai-model'] as const;
  const activeApiTab = useMemo(() => {
    const requested = searchParams?.get('subtab');
    if (requested && apiSubTabKeys.includes(requested as (typeof apiSubTabKeys)[number])) {
      return requested;
    }
    return 'platform';
  }, [searchParams?.get('subtab')]);
  const [apiKeyForm] = Form.useForm();
  const [providerKeyForm] = Form.useForm();
  const [createdKeyOnce, setCreatedKeyOnce] = useState<{ name: string; key: string } | null>(null);

  const {
    apiKeys,
    providerApiKeys,
    loading,
    showApiKey,
    showProviderKeyModal,
    editingProvider,
    toggleApiKeyVisibility,
    setShowProviderKeyModal,
    setEditingProvider,
    loadApiKeys,
    createApiKey,
    deleteApiKey,
    loadProviderApiKeys,
    saveProviderKey,
  } = useSettingsStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  /** Bumps ModelSelector to refetch /api/ai/models after provider key save */
  const [aiModelsReloadNonce, setAiModelsReloadNonce] = useState(0);

  useEffect(() => {
    loadApiKeys();
    loadProviderApiKeys();
  }, [loadApiKeys, loadProviderApiKeys]);

  const providers = useMemo(
    () =>
      PROVIDER_CARD_ORDER.map((key) => {
        const { nameKey, descKey } = PROVIDER_I18N_KEYS[key];
        return {
          name: t(nameKey),
          key,
          description: t(descKey),
          comingSoon: key === 'ollama',
        };
      }),
    [t]
  );

  const editingProviderDisplayName = editingProvider
    ? t(PROVIDER_I18N_KEYS[editingProvider]?.nameKey ?? 'unknown')
    : '';

  const providerModelSelectOptions = useMemo(() => {
    if (!editingProvider) return [];
    const defs = PROVIDER_MODEL_DEFS[editingProvider] ?? [];
    return [
      ...defs.map((def) => ({
        value: def.value,
        label: buildProviderModelLabel(t, def),
      })),
      { value: '__custom__', label: t('select_model_other_option') },
    ];
  }, [editingProvider, t]);

  const handleCreateApiKey = async (values: { name: string }) => {
    try {
      const created = await createApiKey(values);
      setShowCreateModal(false);
      apiKeyForm.resetFields();
      if (created?.key) {
        setCreatedKeyOnce({ name: created.name || t('api_key_default_display_name'), key: created.key });
      } else {
        message.success(t('api_key_created'));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : t('api_key_create_failed');
      message.error(msg);
    }
  };

  const handleDeleteApiKey = async (keyId: string) => {
    try {
      await deleteApiKey(keyId);
      message.success(t('api_key_deleted'));
    } catch (error: any) {
      message.error(error?.message || t('api_key_delete_failed'));
    }
  };

  const handleOpenProviderKeyModal = (provider: string) => {
    setEditingProvider(provider);
    setShowProviderKeyModal(true);
    const existingKey = providerApiKeys[provider];
    if (existingKey) {
      const defs = PROVIDER_MODEL_DEFS[provider] ?? [];
      const isPredefined = defs.some((d) => d.value === existingKey.model);
      providerKeyForm.setFieldsValue({
        api_key: existingKey.api_key ?? '',
        model: isPredefined ? existingKey.model : existingKey.model ? '__custom__' : '',
        model_custom: isPredefined ? undefined : (existingKey.model ?? ''),
        endpoint: existingKey.endpoint ?? '',
      });
    } else {
      providerKeyForm.resetFields();
    }
  };

  const handleSaveProviderKey = async (values: {
    api_key?: string;
    model?: string;
    model_custom?: string;
    endpoint?: string;
  }) => {
    if (!editingProvider) return;
    const modelToSave = (values.model === '__custom__' ? values.model_custom : values.model) ?? '';
    try {
      await saveProviderKey(editingProvider, {
        api_key: values.api_key ?? '',
        model: modelToSave,
        endpoint: values.endpoint,
      });
      message.success(t('api_key_provider_saved'));
      setAiModelsReloadNonce((n) => n + 1);
      setShowProviderKeyModal(false);
      setEditingProvider(null);
      providerKeyForm.resetFields();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : t('api_keys_provider_save_failed');
      message.error(msg);
    }
  };

  const apiKeyColumns = [
    {
      title: t('name'),
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: t('api_key'),
      dataIndex: 'key',
      key: 'key',
      render: (text: string, record: ApiKey) => (
        <Space>
          <Text code>{showApiKey[record.id] ? record.key : '••••••••••••' + record.key.slice(-4)}</Text>
          <Button
            type="text"
            size="small"
            icon={showApiKey[record.id] ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={() => toggleApiKeyVisibility(record.id)}
          />
        </Space>
      ),
    },
    {
      title: t('created_at'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => (date ? new Date(date).toLocaleDateString() : t('profile_na')),
    },
    {
      title: t('last_used'),
      dataIndex: 'last_used',
      key: 'last_used',
      render: (date: string) => (date ? new Date(date).toLocaleDateString() : t('never')),
    },
    {
      title: t('status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : status === 'expired' ? 'orange' : 'red'}>
          {status?.toUpperCase() || t('unknown')}
        </Tag>
      ),
    },
    {
      title: t('col_actions'),
      key: 'actions',
      render: (_: any, record: ApiKey) => (
        <Popconfirm
          title={t('api_key_delete_confirm_title')}
          description={t('api_key_delete_confirm_desc')}
          onConfirm={() => handleDeleteApiKey(record.id)}
          okText={t('yes')}
          cancelText={t('no')}
        >
          <Button type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  // Register "Create Key" in page header only on the platform keys tab
  useEffect(() => {
    onSetAction?.(
      activeApiTab === 'platform' ? (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowCreateModal(true)}>
          {t('create_api_key')}
        </Button>
      ) : null
    );
  }, [activeApiTab, onSetAction]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApiTabChange = useCallback(
    (nextKey: string) => {
      const params = new URLSearchParams(searchParams?.toString());
      params.set('tab', 'api-keys');
      params.set('subtab', nextKey);
      router.replace(`/settings?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  return (
    <div>
      <Tabs
        className="settings-subtabs"
        activeKey={activeApiTab}
        onChange={handleApiTabChange}
        destroyInactiveTabPane
        items={[
          {
            key: 'platform',
            label: t('platform_api_keys'),
            children: (
              <div style={{ paddingTop: 4 }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 14, fontSize: 13 }}>
                  {t('platform_api_keys_desc')}
                </Text>
                <Table
                  dataSource={apiKeys}
                  columns={apiKeyColumns}
                  rowKey="id"
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  scroll={{ x: 'max-content' }}
                />
              </div>
            ),
          },
          {
            key: 'providers',
            label: t('ai_provider_keys'),
            children: (
              <div style={{ paddingTop: 4 }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
                  {t('ai_provider_keys_desc')}
                </Text>
                {/* Provider list — flat rows, no stacked full-width cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {providers.map((provider) => (
                    <div
                      key={provider.key}
                      onClick={() => !provider.comingSoon && handleOpenProviderKeyModal(provider.key)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--ant-color-border)',
                        background: 'var(--ant-color-bg-container)',
                        cursor: provider.comingSoon ? 'default' : 'pointer',
                        opacity: provider.comingSoon ? 0.6 : 1,
                        transition: 'background 0.12s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!provider.comingSoon)
                          (e.currentTarget as HTMLElement).style.background = 'var(--ant-color-fill-tertiary)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = 'var(--ant-color-bg-container)';
                      }}
                    >
                      {getAiProviderLogo(provider.key) ? (
                        <img src={getAiProviderLogo(provider.key)} alt="" width={20} height={20}
                          style={{ objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                      ) : (
                        <RobotOutlined style={{ fontSize: 18, color: 'var(--ant-color-text-secondary)', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 13, lineHeight: 1.3 }}>{provider.name}</div>
                        <Text type="secondary" style={{ fontSize: 11 }}>{provider.description}</Text>
                      </div>
                      {provider.comingSoon ? (
                        <Tag style={{ margin: 0, fontSize: 10 }}>{t('coming_soon')}</Tag>
                      ) : providerApiKeys[provider.key] ? (
                        <Tag color="green" style={{ margin: 0, fontSize: 10 }}>{t('configured')}</Tag>
                      ) : (
                        <Tag style={{ margin: 0, fontSize: 10 }}>Not set</Tag>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ),
          },
          {
            key: 'ai-model',
            label: t('default_ai_model'),
            children: (
              <div style={{ paddingTop: 4 }}>
                <Text type="secondary" style={{ display: 'block', marginBottom: 14, fontSize: 13 }}>
                  {t('default_ai_model_desc')}
                </Text>
                <ModelSelector
                  persistPreference
                  reloadNonce={aiModelsReloadNonce}
                  onChange={() => message.success(t('model_preference_saved'))}
                />
              </div>
            ),
          },
        ]}
      />

      {/* Shown once after creating a platform API key — copy and store securely */}
      <Modal
        title={t('api_key_created_title')}
        open={!!createdKeyOnce}
        onCancel={() => setCreatedKeyOnce(null)}
        footer={[
          <Button
            key="copy"
            type="primary"
            onClick={() => {
              if (createdKeyOnce?.key) {
                void navigator.clipboard.writeText(createdKeyOnce.key);
                message.success(t('copied_to_clipboard'));
              }
            }}
          >
            {t('copy_key')}
          </Button>,
          <Button key="done" onClick={() => setCreatedKeyOnce(null)}>
            {t('done')}
          </Button>,
        ]}
        closable
      >
        {createdKeyOnce && (
          <>
            <Alert
              type="warning"
              message={t('api_key_store_securely')}
              style={{ marginBottom: 16 }}
            />
            <Text strong>{createdKeyOnce.name}</Text>
            <div style={{ marginTop: 8, wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 12 }}>
              {createdKeyOnce.key}
            </div>
          </>
        )}
      </Modal>

      {/* Create API Key Modal */}
      <Modal
        title={t('create_api_key')}
        open={showCreateModal}
        onCancel={() => {
          setShowCreateModal(false);
          apiKeyForm.resetFields();
        }}
        footer={null}
      >
        <Form form={apiKeyForm} layout="vertical" onFinish={handleCreateApiKey}>
          <Form.Item
            name="name"
            label={t('api_key_name')}
            rules={[{ required: true, message: t('api_key_name_required') }]}
          >
            <Input placeholder={t('api_key_name_placeholder')} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button onClick={() => setShowCreateModal(false)}>{t('cancel')}</Button>
              <Button type="primary" htmlType="submit" loading={loading}>
                {t('create_key')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Provider Key Modal */}
      <Modal
        title={t('configure_provider_api_key', { provider: editingProviderDisplayName })}
        open={showProviderKeyModal}
        onCancel={() => {
          setShowProviderKeyModal(false);
          setEditingProvider(null);
          providerKeyForm.resetFields();
        }}
        footer={null}
      >
        <Form form={providerKeyForm} layout="vertical" onFinish={handleSaveProviderKey}>
          <Form.Item
            name="api_key"
            label={t('api_key')}
            rules={[{ required: true, message: t('api_key_enter_required') }]}
            extra={t('api_key_stored_securely')}
          >
            <Input.Password placeholder={t('api_key_placeholder')} autoComplete="off" />
          </Form.Item>
          {editingProvider === 'azure_openai' && (
            <Form.Item
              name="endpoint"
              label={t('endpoint_url')}
              rules={[{ required: true, message: t('azure_endpoint_required') }]}
            >
              <Input placeholder={t('azure_endpoint_placeholder')} type="url" autoComplete="off" />
            </Form.Item>
          )}
          <Form.Item
            name="model"
            label={t('default_model')}
            extra={t('default_model_help')}
          >
            <Select
              placeholder={t('select_model_or_custom')}
              allowClear
              showSearch
              optionFilterProp="label"
              options={providerModelSelectOptions}
              notFoundContent={t('enter_custom_model_below')}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev?.model === '__custom__' || curr?.model === '__custom__'}
          >
            {({ getFieldValue }) =>
              getFieldValue('model') === '__custom__' ? (
                <Form.Item name="model_custom" label={t('custom_model_id')}>
                  <Input placeholder={t('custom_model_id_placeholder')} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Divider />
          <Form.Item>
            <Space>
              <Button onClick={() => setShowProviderKeyModal(false)}>{t('cancel')}</Button>
              <Button type="primary" htmlType="submit" loading={loading}>
                {t('save_key')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
