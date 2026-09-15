import React, { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  App,
  Card,
  Form,
  Button,
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
  PlusOutlined,
  DeleteOutlined,
  RobotOutlined,
  ReloadOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { getAiProviderLogo } from '@/config/aiProviders';
import { fetchApi } from '@/utils/api';
import type { ApiKey } from '../types';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { asDynamicComponent } from '@/utils/asDynamicModule';

const ModelSelectorFallback = () => null;
const ModelSelector = dynamic(
  () =>
    import('@/components/ai/ModelSelector/ModelSelector').then((m) =>
      asDynamicComponent(m.ModelSelector ?? m.default, ModelSelectorFallback),
    ),
  { ssr: false },
);

const { Text } = Typography;

/** Predefined model IDs per AI provider — aligned with LLM Stats & LiteLLM (latest). Default: gpt-5.6-terra. */
type ProviderModelDef = {
  value: string;
  labelKey: string;
  suffix?: 'default' | 'latest';
};

const OPENAI_AZURE_MODEL_DEFS: ProviderModelDef[] = [
  // GPT-5.6 (Sol/Terra/Luna) is the current flagship generation as of Jul 2026.
  { value: 'gpt-5.6-terra', labelKey: 'ai_model_gpt_5_6_terra', suffix: 'default' },
  { value: 'gpt-5.6-luna', labelKey: 'ai_model_gpt_5_6_luna' },
  { value: 'gpt-5.6-sol', labelKey: 'ai_model_gpt_5_6_sol' },
  { value: 'gpt-5.2', labelKey: 'ai_model_gpt_5_2' },
  { value: 'gpt-5.1', labelKey: 'ai_model_gpt_5_1' },
  { value: 'gpt-5', labelKey: 'ai_model_gpt_5' },
  { value: 'gpt-5-mini', labelKey: 'ai_model_gpt_5_mini' },
  { value: 'gpt-5-nano', labelKey: 'ai_model_gpt_5_nano' },
  // gpt-4.1-mini retires 2026-10-23; gpt-4o/gpt-4o-mini are legacy/at-risk (no firm
  // date) — kept selectable via the custom-model field rather than listed here.
  { value: 'gpt-4.1-mini', labelKey: 'ai_model_gpt_4_1_mini' },
  { value: 'gpt-4.1', labelKey: 'ai_model_gpt_4_1' },
  { value: 'gpt-4.1-nano', labelKey: 'ai_model_gpt_4_1_nano' },
  { value: 'o1-mini', labelKey: 'ai_model_o1_mini' },
  { value: 'gpt-5.1-codex-mini', labelKey: 'ai_model_gpt_5_1_codex_mini' },
];

const PROVIDER_MODEL_DEFS: Record<string, ProviderModelDef[]> = {
  openai: OPENAI_AZURE_MODEL_DEFS,
  azure_openai: OPENAI_AZURE_MODEL_DEFS,
  anthropic: [
    { value: 'claude-sonnet-5', labelKey: 'ai_model_claude_sonnet_5', suffix: 'default' },
    { value: 'claude-opus-4-8', labelKey: 'ai_model_claude_opus_4_8' },
    { value: 'claude-haiku-4-5-20251001', labelKey: 'ai_model_claude_haiku_4_5' },
    { value: 'claude-3-7-sonnet-20250219', labelKey: 'ai_model_claude_3_7_sonnet' },
    { value: 'claude-3-5-sonnet-20240620', labelKey: 'ai_model_claude_3_5_sonnet' },
    { value: 'claude-3-haiku-20240307', labelKey: 'ai_model_claude_3_haiku' },
  ],
  // gemini-2.0-flash was shut down 2026-06-01 and gemini-1.5-* is fully retired —
  // dropped rather than kept as broken presets. The 2.5 family is nominally alive
  // until Oct 2026 but has been intermittently 404ing since Jul 2026, so 3.x is
  // the default now.
  google: [
    { value: 'gemini-3.6-flash', labelKey: 'ai_model_gemini_3_6_flash', suffix: 'default' },
    { value: 'gemini-3.5-flash-lite', labelKey: 'ai_model_gemini_3_5_flash_lite' },
    { value: 'gemini-3.1-pro-preview', labelKey: 'ai_model_gemini_3_1_pro_preview' },
    { value: 'gemini-3-flash-preview', labelKey: 'ai_model_gemini_3_flash_preview' },
    { value: 'gemini-2.5-pro', labelKey: 'ai_model_gemini_2_5_pro' },
    { value: 'gemini-2.5-flash', labelKey: 'ai_model_gemini_2_5_flash' },
  ],
  // DeepSeek retired the "deepseek-chat"/"deepseek-reasoner" aliases on 2026-07-24
  // in favor of explicit V4 model ids.
  deepseek: [
    { value: 'deepseek-v4-flash', labelKey: 'ai_model_deepseek_v4_flash', suffix: 'default' },
    { value: 'deepseek-v4-pro', labelKey: 'ai_model_deepseek_v4_pro' },
  ],
  // OpenRouter fronts hundreds of vendor/model slugs (e.g. "z-ai/glm-4.6") — no small
  // fixed list covers it, so these are the presets called out explicitly; anything
  // else goes through the custom-model field below.
  // qwen3.8-27b is the default pick here despite the "Flash" variant's name:
  // OpenRouter's own measured P50 numbers show 27B at 0.48s TTFT / 75 tok/s
  // vs Flash's 3.07s TTFT / 54 tok/s — faster despite not being the "Flash"
  // branded one. Muse Glimmer 30B is Meta Superintelligence Labs' first
  // open-weight release, distinct from the Llama family.
  openrouter: [
    { value: 'qwen/qwen3.8-27b', labelKey: 'ai_model_qwen3_8_27b', suffix: 'default' },
    { value: 'z-ai/glm-5.2', labelKey: 'ai_model_glm_5_2' },
    { value: 'qwen/qwen3.8-flash', labelKey: 'ai_model_qwen3_8_flash' },
    { value: 'qwen/qwen3.8-max', labelKey: 'ai_model_qwen3_8_max' },
    { value: 'meta/muse-glimmer-30b', labelKey: 'ai_model_muse_glimmer_30b' },
  ],
  // Suggested local tags only — never auto-enabled in chat until the user
  // adds them (or discovers them from a running Ollama). Tags must match
  // `ollama pull` / `ollama list` exactly.
  ollama: [
    { value: 'qwen3.8:27b', labelKey: 'ai_model_qwen3_8_27b' },
    { value: 'muse-glimmer:30b', labelKey: 'ai_model_muse_glimmer_30b' },
    { value: 'llama3.2:1b', labelKey: 'ai_model_llama3_2_1b' },
  ],
};

function modelsFromProviderKey(key: { model?: string; models?: string[] } | undefined): string[] {
  if (!key) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const mid of key.models ?? []) {
    const id = String(mid || '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  const legacy = String(key.model || '').trim();
  if (legacy && !seen.has(legacy)) {
    out.unshift(legacy);
  }
  return out;
}

function defaultPresetForProvider(provider: string): string | undefined {
  const defs = PROVIDER_MODEL_DEFS[provider] ?? [];
  return defs.find((d) => d.suffix === 'default')?.value ?? defs[0]?.value;
}

function buildProviderModelLabel(translate: (key: string) => string, def: ProviderModelDef): string {
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
  deepseek: { nameKey: 'api_keys_provider_name_deepseek', descKey: 'api_keys_provider_desc_deepseek' },
  openrouter: { nameKey: 'api_keys_provider_name_openrouter', descKey: 'api_keys_provider_desc_openrouter' },
  ollama: { nameKey: 'api_keys_provider_name_ollama', descKey: 'api_keys_provider_desc_ollama' },
};

const PROVIDER_CARD_ORDER = ['openai', 'anthropic', 'google', 'azure_openai', 'deepseek', 'openrouter', 'ollama'] as const;

import type { TabComponentProps } from '../page';

export const ApiKeysTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('settings');
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  // 'ai-model' is a legacy subtab key from before "Default AI Model" was folded into
  // "AI Providers" below — still accepted so old deep links/bookmarks land somewhere valid.
  const apiSubTabKeys = ['platform', 'providers', 'ai-model'] as const;
  const activeApiTab = useMemo(() => {
    const requested = searchParams?.get('subtab');
    if (requested === 'ai-model') return 'providers';
    if (requested && apiSubTabKeys.includes(requested as (typeof apiSubTabKeys)[number])) {
      return requested;
    }
    return 'providers';
  }, [searchParams?.get('subtab')]);
  const [apiKeyForm] = Form.useForm();
  const [providerKeyForm] = Form.useForm();
  const [createdKeyOnce, setCreatedKeyOnce] = useState<{ name: string; key: string } | null>(null);

  const {
    apiKeys,
    providerApiKeys,
    loading,
    showProviderKeyModal,
    editingProvider,
    setShowProviderKeyModal,
    setEditingProvider,
    loadApiKeys,
    createApiKey,
    deleteApiKey,
    loadProviderApiKeys,
    saveProviderKey,
    deleteProviderKey,
    availableModels,
  } = useSettingsStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  /** Bumps ModelSelector to refetch /api/ai/models after provider key save */
  const [aiModelsReloadNonce, setAiModelsReloadNonce] = useState(0);
  /** Enabled model ids for the provider currently being edited */
  const [enabledModels, setEnabledModels] = useState<string[]>([]);
  const [customModelDraft, setCustomModelDraft] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [clearingProvider, setClearingProvider] = useState(false);

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
          comingSoon: false,
        };
      }),
    [t]
  );

  const editingProviderDisplayName = editingProvider
    ? t(PROVIDER_I18N_KEYS[editingProvider]?.nameKey ?? 'unknown')
    : '';

  const providerPresetDefs = useMemo(() => {
    if (!editingProvider) return [];
    return PROVIDER_MODEL_DEFS[editingProvider] ?? [];
  }, [editingProvider]);

  const addEnabledModel = useCallback((raw: string) => {
    const id = raw.trim();
    if (!id) return;
    setEnabledModels((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const removeEnabledModel = useCallback((id: string) => {
    setEnabledModels((prev) => prev.filter((m) => m !== id));
  }, []);

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
    setCustomModelDraft('');
    setDiscoveredModels([]);
    const existingKey = providerApiKeys[provider];
    const existingModels = modelsFromProviderKey(existingKey);
    setEnabledModels(existingModels);
    if (existingKey) {
      providerKeyForm.setFieldsValue({
        api_key: existingKey.api_key ?? '',
        endpoint: existingKey.endpoint ?? '',
<<<<<<< HEAD
        workspace_id: existingKey.workspace_id ?? '',
=======
        preferred_model: existingModels[0] ?? undefined,
>>>>>>> da629f5 (update all refinements)
      });
    } else {
      providerKeyForm.resetFields();
      if (provider === 'ollama') {
        providerKeyForm.setFieldsValue({
          endpoint: 'http://ollama:11434',
        });
      } else {
        const preset = defaultPresetForProvider(provider);
        if (preset) {
          setEnabledModels([preset]);
          providerKeyForm.setFieldsValue({ preferred_model: preset });
        }
      }
    }
  };

  const handleDiscoverOllama = async () => {
    const endpoint = String(providerKeyForm.getFieldValue('endpoint') || '').trim();
    if (!endpoint) {
      message.warning(t('ollama_endpoint_required_discover'));
      return;
    }
    setDiscoverLoading(true);
    try {
      const qs = new URLSearchParams({ endpoint });
      const data = await fetchApi<{ models?: { id?: string; name?: string }[] }>(
        `users/ai-provider-keys/ollama/tags?${qs.toString()}`,
      );
      const ids = (data?.models ?? [])
        .map((m) => String(m.id || m.name || '').trim())
        .filter(Boolean);
      setDiscoveredModels(ids);
      if (!ids.length) {
        message.info(t('ollama_discover_empty'));
      } else {
        message.success(t('ollama_discover_found', { count: ids.length }));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : t('ollama_discover_failed');
      message.error(msg);
    } finally {
      setDiscoverLoading(false);
    }
  };

  const handleClearProviderKey = async () => {
    if (!editingProvider) return;
    setClearingProvider(true);
    try {
      await deleteProviderKey(editingProvider);
      setAiModelsReloadNonce((n) => n + 1);
      setShowProviderKeyModal(false);
      setEditingProvider(null);
      setEnabledModels([]);
      setDiscoveredModels([]);
      providerKeyForm.resetFields();
      message.success(t('provider_config_cleared'));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : t('provider_config_clear_failed');
      message.error(msg);
    } finally {
      setClearingProvider(false);
    }
  };

  const handleSaveProviderKey = async (values: {
    api_key?: string;
    endpoint?: string;
<<<<<<< HEAD
    workspace_id?: string;
=======
    preferred_model?: string;
>>>>>>> da629f5 (update all refinements)
  }) => {
    if (!editingProvider) return;
    const modelsToSave = [...enabledModels];
    if (editingProvider === 'ollama' && modelsToSave.length === 0) {
      message.warning(t('ollama_models_required'));
      return;
    }
    let preferred = (values.preferred_model || '').trim();
    if (preferred && !modelsToSave.includes(preferred)) {
      modelsToSave.unshift(preferred);
    }
    if (!preferred && modelsToSave.length) {
      preferred = modelsToSave[0];
    }
    // Prefer preferred first in the list for stable byok_{provider} id.
    const ordered =
      preferred && modelsToSave.includes(preferred)
        ? [preferred, ...modelsToSave.filter((m) => m !== preferred)]
        : modelsToSave;

    const savedProvider = editingProvider;
    try {
      await saveProviderKey(savedProvider, {
        api_key: values.api_key ?? '',
        model: preferred || ordered[0] || '',
        models: ordered,
        endpoint: values.endpoint,
        workspace_id: values.workspace_id,
      });
      setAiModelsReloadNonce((n) => n + 1);
      setShowProviderKeyModal(false);
      setEditingProvider(null);
      setEnabledModels([]);
      setDiscoveredModels([]);
      providerKeyForm.resetFields();

      const byokModels = useSettingsStore
        .getState()
        .availableModels.filter((m) => m.provider === savedProvider && m.id.startsWith('byok_'));
      const probe = byokModels[0];
      if (probe) {
        try {
          const status = await fetchApi(`/ai/model-status?model_id=${probe.id}`);
          if (status?.success === false || status?.available === false) {
            message.warning(t('api_key_saved_but_invalid'));
          } else {
            message.success(t('api_key_provider_saved'));
          }
        } catch {
          message.success(t('api_key_provider_saved'));
        }
      } else {
        message.success(t('api_key_provider_saved'));
      }
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
        // RELIABILITY: the list endpoint (GET /users/api-keys) never returns the
        // real secret — the backend masks it before storing (mask_key(secret)),
        // by design (the full key is shown exactly once, at creation). This used
        // to re-mask that already-masked string on top ('••••••••••••' +
        // record.key.slice(-4)), which happened to render the same bullets by
        // coincidence but made toggling "show" a no-op — there was never a real
        // secret in `record.key` to reveal for a key loaded from the list.
        <Text code>{record.key}</Text>
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
          <Button type="text" danger className="icon-only-btn" icon={<DeleteOutlined />} />
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
      <Card variant="borderless" style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}>
        <Tabs
          className="settings-inline-tabs bg-transparent p-0 shadow-none rounded-none [&_.ant-tabs-body-holder]:block [&_.ant-tabs-body-holder]:h-auto [&_.ant-tabs-body-holder]:min-h-0 [&_.ant-tabs-body-holder]:flex-none [&_.ant-tabs-body-holder]:overflow-visible [&_.ant-tabs-body-holder]:!p-0 [&_.ant-tabs-body]:block [&_.ant-tabs-body]:h-auto [&_.ant-tabs-body]:min-h-0 [&_.ant-tabs-body]:flex-none [&_.ant-tabs-body]:overflow-visible [&_.ant-tabs-content]:!p-0 [&>.ant-tabs-nav]:mb-4 [&>.ant-tabs-nav::before]:border-b-[var(--ant-color-border-secondary)] [&_.ant-tabs-tab]:rounded-md [&_.ant-tabs-tab]:!px-3.5 [&_.ant-tabs-tab]:!py-1.5 [&_.ant-tabs-tab]:text-[13px] [&_.ant-tabs-tab]:border-0 [&_.ant-tabs-tab]:bg-transparent [&_.ant-tabs-tab:hover]:bg-[var(--ant-color-fill-quaternary)] [&_.ant-tabs-tab:hover]:text-[var(--ant-color-text)] [&_.ant-tabs-tab-active]:bg-[var(--ant-color-fill-quaternary)] [&_.ant-tabs-tab-active]:!text-[var(--ant-color-primary)] [&_.ant-tabs-tab-active]:font-medium [&_.ant-tabs-ink-bar]:h-0.5 [&_.ant-tabs-ink-bar]:rounded-sm"
          activeKey={activeApiTab}
          onChange={handleApiTabChange}
          destroyOnHidden
          items={[
            {
              key: 'providers',
              label: t('ai_providers_tab'),
              children: (
                <div style={{ paddingTop: 4 }}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
                    {t('ai_provider_keys_desc')}
                  </Text>
                  {/* Provider list — flat rows, no stacked full-width cards */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {providers.map((provider) => (
                      <div
                        className="mt-1"
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
                          <img
                            src={getAiProviderLogo(provider.key)}
                            alt=""
                            width={20}
                            height={20}
                            style={{ objectFit: 'contain', borderRadius: 3, flexShrink: 0 }}
                          />
                        ) : (
                          <RobotOutlined
                            style={{ fontSize: 18, color: 'var(--ant-color-text-secondary)', flexShrink: 0 }}
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 13, lineHeight: 1.3 }}>{provider.name}</div>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {provider.description}
                          </Text>
                        </div>
                        {provider.comingSoon ? (
                          <Tag style={{ margin: 0, fontSize: 10 }}>{t('coming_soon')}</Tag>
                        ) : providerApiKeys[provider.key] ? (
                          <Tag color="green" style={{ margin: 0, fontSize: 10 }}>
                            {(() => {
                              const n = modelsFromProviderKey(providerApiKeys[provider.key]).length;
                              return n > 0
                                ? t('configured_with_models', { count: n })
                                : t('configured');
                            })()}
                          </Tag>
                        ) : (
                          <Tag style={{ margin: 0, fontSize: 10 }}>{t('not_set')}</Tag>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Default model lives right below the keys that power it, instead of a separate tab */}
                  <Divider style={{ margin: '28px 0 20px' }} />
                  <ModelSelector
                    persistPreference
                    reloadNonce={aiModelsReloadNonce}
                    onChange={() => message.success(t('model_preference_saved'))}
                  />
                </div>
              ),
            },
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
          ]}
        />
      </Card>

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
            <Alert type="warning" message={t('api_key_store_securely')} style={{ marginBottom: 16 }} />
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
        title={
          editingProvider === 'ollama'
            ? editingProviderDisplayName
            : t('configure_provider_api_key', { provider: editingProviderDisplayName })
        }
        open={showProviderKeyModal}
        onCancel={() => {
          setShowProviderKeyModal(false);
          setEditingProvider(null);
          setEnabledModels([]);
          setDiscoveredModels([]);
          setCustomModelDraft('');
          providerKeyForm.resetFields();
        }}
        footer={null}
        destroyOnHidden
        width={560}
      >
        <Form form={providerKeyForm} layout="vertical" onFinish={handleSaveProviderKey}>
          {editingProvider !== 'ollama' && (
            <Form.Item
              name="api_key"
              label={t('api_key')}
              rules={[{ required: true, message: t('api_key_enter_required') }]}
              extra={t('api_key_stored_securely')}
            >
              <Input.Password placeholder={t('api_key_placeholder')} autoComplete="off" />
            </Form.Item>
          )}
          {(editingProvider === 'azure_openai' || editingProvider === 'ollama') && (
            <Form.Item
              name="endpoint"
              label={t('endpoint_url')}
              rules={[
                {
                  required: true,
                  message:
                    editingProvider === 'ollama'
                      ? t('ollama_endpoint_required')
                      : t('azure_endpoint_required'),
                },
              ]}
              extra={editingProvider === 'ollama' ? t('ollama_endpoint_help') : undefined}
            >
              {editingProvider === 'ollama' ? (
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    placeholder="http://localhost:11434"
                    type="url"
                    autoComplete="off"
                  />
                  <Button
                    icon={<ReloadOutlined />}
                    loading={discoverLoading}
                    onClick={(e) => {
                      e.preventDefault();
                      void handleDiscoverOllama();
                    }}
                  >
                    {t('ollama_discover')}
                  </Button>
                </Space.Compact>
              ) : (
                <Input
                  placeholder={t('azure_endpoint_placeholder')}
                  type="url"
                  autoComplete="off"
                />
              )}
            </Form.Item>
          )}

          <Form.Item
            label={t('enabled_models_label')}
            required={editingProvider === 'ollama'}
            extra={t('enabled_models_help')}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, minHeight: 28 }}>
              {enabledModels.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('enabled_models_empty')}
                </Text>
              ) : (
                enabledModels.map((id) => (
                  <Tag
                    key={id}
                    closable
                    onClose={(e) => {
                      e.preventDefault();
                      removeEnabledModel(id);
                      const preferred = providerKeyForm.getFieldValue('preferred_model');
                      if (preferred === id) {
                        const next = enabledModels.filter((m) => m !== id)[0];
                        providerKeyForm.setFieldsValue({ preferred_model: next });
                      }
                    }}
                    style={{ margin: 0 }}
                  >
                    {id}
                  </Tag>
                ))
              )}
            </div>

            {providerPresetDefs.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                  {t('suggested_models')}
                </Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {providerPresetDefs.map((def) => {
                    const active = enabledModels.includes(def.value);
                    return (
                      <Tag.CheckableTag
                        key={def.value}
                        checked={active}
                        onChange={(checked) => {
                          if (checked) {
                            addEnabledModel(def.value);
                            if (!providerKeyForm.getFieldValue('preferred_model')) {
                              providerKeyForm.setFieldsValue({ preferred_model: def.value });
                            }
                          } else {
                            removeEnabledModel(def.value);
                          }
                        }}
                      >
                        {buildProviderModelLabel(t, def)}
                      </Tag.CheckableTag>
                    );
                  })}
                </div>
              </div>
            )}

            {editingProvider === 'ollama' && discoveredModels.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                  {t('ollama_discovered_models')}
                </Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {discoveredModels.map((id) => {
                    const active = enabledModels.includes(id);
                    return (
                      <Tag.CheckableTag
                        key={id}
                        checked={active}
                        onChange={(checked) => {
                          if (checked) {
                            addEnabledModel(id);
                            if (!providerKeyForm.getFieldValue('preferred_model')) {
                              providerKeyForm.setFieldsValue({ preferred_model: id });
                            }
                          } else {
                            removeEnabledModel(id);
                          }
                        }}
                      >
                        {id}
                      </Tag.CheckableTag>
                    );
                  })}
                </div>
              </div>
            )}

            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={customModelDraft}
                onChange={(e) => setCustomModelDraft(e.target.value)}
                placeholder={
                  editingProvider === 'ollama'
                    ? t('custom_model_id_placeholder_ollama')
                    : t('custom_model_id_placeholder')
                }
                onPressEnter={(e) => {
                  e.preventDefault();
                  if (!customModelDraft.trim()) return;
                  addEnabledModel(customModelDraft);
                  if (!providerKeyForm.getFieldValue('preferred_model')) {
                    providerKeyForm.setFieldsValue({ preferred_model: customModelDraft.trim() });
                  }
                  setCustomModelDraft('');
                }}
              />
              <Button
                icon={<PlusOutlined />}
                onClick={() => {
                  if (!customModelDraft.trim()) return;
                  addEnabledModel(customModelDraft);
                  if (!providerKeyForm.getFieldValue('preferred_model')) {
                    providerKeyForm.setFieldsValue({ preferred_model: customModelDraft.trim() });
                  }
                  setCustomModelDraft('');
                }}
              >
                {t('add_model')}
              </Button>
            </Space.Compact>
          </Form.Item>

          {enabledModels.length > 0 && (
            <Form.Item
              name="preferred_model"
              label={t('preferred_model_label')}
              extra={t('preferred_model_help')}
            >
              <Select
                placeholder={t('preferred_model_placeholder')}
                options={enabledModels.map((id) => ({ value: id, label: id }))}
                allowClear
              />
            </Form.Item>
          )}
<<<<<<< HEAD
          {editingProvider === 'anthropic' && (
            <Form.Item
              name="workspace_id"
              label={t('anthropic_workspace_id')}
              extra={t('anthropic_workspace_id_help')}
            >
              <Input placeholder="wrkspc_..." autoComplete="off" />
            </Form.Item>
          )}
          <Form.Item name="model" label={t('default_model')} extra={t('default_model_help')}>
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
=======

          <Divider style={{ margin: '12px 0 16px' }} />
          <Form.Item style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              {editingProvider && providerApiKeys[editingProvider] ? (
                <Popconfirm
                  title={t('provider_clear_confirm_title')}
                  description={t('provider_clear_confirm_desc')}
                  onConfirm={() => void handleClearProviderKey()}
                  okText={t('yes')}
                  cancelText={t('no')}
                  okButtonProps={{ danger: true }}
                >
                  <Button danger icon={<ClearOutlined />} loading={clearingProvider}>
                    {t('clear_provider_config')}
                  </Button>
                </Popconfirm>
              ) : (
                <span />
              )}
              <Space>
                <Button onClick={() => setShowProviderKeyModal(false)}>{t('cancel')}</Button>
                <Button type="primary" htmlType="submit" loading={loading}>
                  {t('save_key')}
                </Button>
              </Space>
            </div>
>>>>>>> da629f5 (update all refinements)
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
