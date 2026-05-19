'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    Select,
    Card,
    Space,
    Tag,
    Button,
    Tooltip,
    Alert,
    Typography,
    Badge,
    Spin,
    message
} from 'antd';
import {
    RobotOutlined,
    ThunderboltOutlined,
    HomeOutlined,
    CloudOutlined,
    CrownOutlined,
    CheckOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    ExperimentOutlined,
    SettingOutlined,
    RocketOutlined,
    StarOutlined,
    DownOutlined,
} from '@ant-design/icons';
import { fetchApi } from '@/utils/api';
import { getAiProviderLogo } from '@/config/aiProviders';
import { useTranslations } from 'next-intl';

const { Option } = Select;
const { Text } = Typography;

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  category?: string;
  tier?: string;
  is_local?: boolean;
  available: boolean;
  cost_per_1k_tokens: number;
}

export interface ModelSelectorProps {
  /** Controlled value (model id) */
  value?: string | null;
  /** Called when the user selects a model */
  onModelChange?: (modelId: string) => void;
  /** Alias for onModelChange — used by InlineModeSelector */
  onChange?: (modelId: string) => void;
  showCostInfo?: boolean;
  compact?: boolean;
  defaultModel?: string;
  disabled?: boolean;
  className?: string;
  /** Persist selection to backend preference API */
  persist?: boolean;
  /** Alias for persist — used by settings page */
  persistPreference?: boolean;
  /** Increment to refetch models (e.g. after saving a provider API key in Settings) */
  reloadNonce?: number;
    /** Chat composer: pill shape + chevron (compact toolbar) */
    composerEmbed?: boolean;
}

// ─── Provider styles ──────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  azure: '#0078d4',
  openai: '#10a37f',
  google: '#4285f4',
  ollama: '#7c3aed',
  groq: '#f59e0b',
  anthropic: '#d97706',
  cohere: '#059669',
  auto: 'var(--ant-color-primary)',
};

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  azure: <CloudOutlined />,
  openai: <CloudOutlined />,
  google: <CloudOutlined />,
  ollama: <HomeOutlined />,
  groq: <ThunderboltOutlined />,
  anthropic: <RobotOutlined />,
  cohere: <RobotOutlined />,
  auto: <RocketOutlined />,
};

function ProviderLogo({ provider, size = 18 }: { provider: string; size?: number }) {
  const logo = getAiProviderLogo(provider);
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        style={{ objectFit: 'contain', borderRadius: 4, flexShrink: 0 }}
      />
    );
  }
  return <>{PROVIDER_ICONS[provider] || <RobotOutlined style={{ fontSize: size }} />}</>;
}

function categoryTag(model: ModelInfo): { color: string; label: string } {
  if (model.is_local) return { color: 'purple', label: 'Local' };
  if (model.tier === 'reasoning' || model.category === 'Premium') return { color: 'gold', label: 'Premium' };
  if (model.category === 'Fast' || model.tier === 'fast') return { color: 'blue', label: 'Fast' };
  return { color: 'default', label: model.category || model.tier || 'Standard' };
}

const FALLBACK_DESC: Record<string, string> = {
  auto: 'Automatically picks the best model for each task — recommended for most users.',
  azure_gpt41_mini:
    'Fast, cost-effective model for everyday analysis — great for SQL generation, summaries, and quick insights.',
  openai_gpt4o_mini: 'Reliable general-purpose model with good quality and low latency — ideal for daily use.',
  azure_reasoning: 'Premium reasoning model for complex multi-step analysis, deep synthesis, and nuanced insights.',
};

const AUTO_MODEL: ModelInfo = {
  id: 'auto',
  name: 'Auto',
  provider: 'auto',
  cost_per_1k_tokens: 0,
  available: true,
  category: 'auto',
  description: FALLBACK_DESC.auto,
};

/** Composer toolbar: show friendly label; full id stays in tooltip (e.g. "Gemini (gemini-…)" → "Gemini"). */
function shortComposerModelDisplayName(name: string): string {
    const trimmed = name.trim();
    const i = trimmed.indexOf('(');
    if (i > 0) return trimmed.slice(0, i).trim();
    return trimmed;
}

// ─── Component ────────────────────────────────────────────────────────────────

const ModelSelector: React.FC<ModelSelectorProps> = ({
  value,
  onModelChange,
  onChange,
  showCostInfo = true,
  compact = false,
  defaultModel = 'auto',
  disabled = false,
  className = '',
  persist = false,
  persistPreference = false,
  reloadNonce = 0,
    composerEmbed = false,
}) => {
    const t = useTranslations('settings');
  const shouldPersist = persist || persistPreference;
  const handleChange = onModelChange ?? onChange;

    const [models, setModels] = useState<ModelInfo[]>([]);
    const [serverDefault, setServerDefault] = useState<string>('');
    const [selectedModel, setSelectedModel] = useState<string>(value || defaultModel || 'auto');
    const [loading, setLoading] = useState(() => !(compact && composerEmbed));
    const [modelStatus, setModelStatus] = useState<Record<string, { success?: boolean; available?: boolean }>>({});
    const valueRef = useRef(value);
    valueRef.current = value;

  // ── Normalize API response shape ─────────────────────────────────────────
  const normalizeModels = (data: any): { list: ModelInfo[]; def: string } => {
    let list: ModelInfo[] = [];
    let def = '';
    if (!data) return { list, def };

    if (Array.isArray(data.models)) {
      list = data.models;
      def = data.default_model || '';
    } else if (data.models && Array.isArray(data.models.models)) {
      // Legacy double-wrapped shape — kept as fallback
      list = data.models.models;
      def = data.models.default_model || data.default_model || '';
    } else if (Array.isArray(data)) {
      list = data;
    }
    return {
      list: list.map((m: any) => ({
        id: m?.id || 'unknown',
        name: m?.name || m?.id || 'Unknown Model',
        provider: m?.provider || 'openai',
        cost_per_1k_tokens: m?.cost_per_1k_tokens ?? 0,
        available: m?.available !== false,
        description: m?.description || FALLBACK_DESC[m?.id] || '',
        category: m?.category || 'standard',
        tier: m?.tier || 'fast',
        is_local: m?.is_local ?? false,
      })),
      def,
    };
  };

    // ── Load models from backend ──────────────────────────────────────────────
    const loadModels = useCallback(async () => {
        const hideLoadingUi = compact && composerEmbed;
        if (!hideLoadingUi) setLoading(true);
        try {
            const data = await fetchApi('ai/models');
            const { list, def } = normalizeModels(data);
            setModels(list);
            setServerDefault(def);

            // Determine initial selection: persisted backend > localStorage > (server default only outside composer embed) > defaultModel
            let initial = value || '';
            if (!initial && shouldPersist) {
                try {
                    const pref = await fetchApi('users/preferences/ai-model');
                    if (pref?.model_id) initial = pref.model_id;
                } catch { /* ignore */ }
            }
            if (!initial) {
                const lsModel = localStorage.getItem('selected_ai_model');
                if (composerEmbed) {
                    initial = lsModel || defaultModel || 'auto';
                } else {
                    initial = lsModel || def || defaultModel || 'auto';
                }
            }

            // Parent-controlled value wins after async (avoids overwriting pref with stale initial).
            const latest = valueRef.current;
            const fromParent =
                latest !== undefined && latest !== null && String(latest).length > 0 ? String(latest) : null;
            const nextId = fromParent ?? initial;
            setSelectedModel(nextId);
            if (!fromParent) handleChange?.(initial);

            // Probe connection status for each available model
            for (const m of list) {
                if (m.available) testModelConnection(m.id);
            }
        } catch (err: any) {
            const msg = err?.message || t('failed_load_ai_models');
            if (!composerEmbed) {
                message.error(msg.length > 80 ? `${msg.slice(0, 80)}…` : msg);
            }
        } finally {
            setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadModels();
  }, [reloadNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync controlled value changes
  useEffect(() => {
    if (value && value !== selectedModel) setSelectedModel(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Connection probe ──────────────────────────────────────────────────────
  const testModelConnection = async (modelId: string) => {
    try {
      const data = await fetchApi(`/ai/model-status?model_id=${modelId}`);
      setModelStatus((prev) => ({ ...prev, [modelId]: data }));
    } catch {
      setModelStatus((prev) => ({ ...prev, [modelId]: { success: true } }));
    }
  };

  // ── Selection handler ─────────────────────────────────────────────────────
  const onSelect = async (modelId: string) => {
    // Strip labelInValue wrapper if Select returns an object
    const id = typeof modelId === 'object' ? (modelId as any).value : modelId;
    setSelectedModel(id);
    handleChange?.(id);

    // Persist to user preferences in localStorage
    try {
      const prefsStr = localStorage.getItem('userPreferences');
      const prefs = prefsStr ? JSON.parse(prefsStr) : {};
      prefs.aiModel = id;
      localStorage.setItem('userPreferences', JSON.stringify(prefs));
    } catch {
      /* ignore */
    }

    // Persist to backend if requested
    if (shouldPersist) {
      try {
        await fetchApi('users/preferences/ai-model', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model_id: id }),
        });
      } catch {
        /* non-critical */
      }
    }
  };

  const allModels = useMemo(() => [AUTO_MODEL, ...models], [models]);
  const selectedData = allModels.find((m) => m.id === selectedModel);

    // ── Compact mode (chat toolbar) ───────────────────────────────────────────
    if (compact) {
        if (loading && !composerEmbed) return <Spin size="small" style={{ margin: '0 8px' }} />;
        // Composer embed: always show pill (Auto + options) — no blocking spinner or select loading affordance
        const sd = selectedData ?? AUTO_MODEL;
        const toolbarName = composerEmbed ? shortComposerModelDisplayName(sd.name) : sd.name;
        const compactLabel = (
            <span
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: composerEmbed ? 4 : 5,
                    minWidth: 0,
                    maxWidth: '100%',
                }}
            >
                <ProviderLogo provider={sd.provider} size={composerEmbed ? 14 : 16} />
                <span
                    style={{
                        fontSize: composerEmbed ? 11 : 12,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                    }}
                >
                    {toolbarName}
                </span>
            </span>
        );
        return (
            <Tooltip title={composerEmbed ? `${sd.name} · ${sd.provider}` : `${sd.name} (${sd.provider})`}>
            <Select
                value={{
                    value: sd.id,
                    label: compactLabel,
                }}
                labelInValue
                onChange={(v: any) => onSelect(typeof v === 'object' ? v.value : v)}
                loading={composerEmbed ? false : loading}
                disabled={disabled}
                className={`model-selector-compact${composerEmbed ? ' model-selector-composer-embed' : ''}${className ? ` ${className}` : ''}`}
                style={
                    composerEmbed
                        ? { width: 'auto', maxWidth: '100%' }
                        : {
                              minWidth: 72,
                              maxWidth: 168,
                              width: 'clamp(72px, 22vw, 168px)',
                          }
                }
                placeholder={t('ai_model')}
                optionLabelProp="label"
                popupMatchSelectWidth={false}
                popupClassName="model-selector-dropdown"
                variant="borderless"
                suffixIcon={
                    composerEmbed ? (
                        <DownOutlined className="model-selector-composer-chevron" />
                    ) : null
                }
            >
                {allModels.map(model => {
                    const providerColor = PROVIDER_COLORS[model.provider] || '#6b7280';
                    const icon = <ProviderLogo provider={model.provider} size={18} />;
                    const tag = categoryTag(model);
                    const isSelected = model.id === selectedModel;
                    return (
                        <Option
                            key={model.id}
                            value={model.id}
                            disabled={!model.available}
                            label={
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ color: providerColor, fontSize: 12 }}>{icon}</span>
                                    <span style={{ fontSize: 12 }}>{model.name}</span>
                                </span>
                            }
                        >
                            <Tooltip
                                title={
                                    <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 260 }}>
                                        <div style={{ fontWeight: 600, marginBottom: 2 }}>{model.name}</div>
                                        <div style={{ opacity: 0.85 }}>{model.description}</div>
                                        {model.cost_per_1k_tokens === 0 && model.id !== 'auto' && (
                                            <div style={{ marginTop: 4, color: '#4ade80' }}>Free (local/private)</div>
                                        )}
                                    </div>
                                }
                                placement="left"
                                mouseEnterDelay={0.3}
                            >
                                <div className="model-option-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ color: providerColor, fontSize: 13, flexShrink: 0 }}>{icon}</span>
                                    <span className="model-option-name" style={{ flex: 1, fontSize: 13 }}>{model.name}</span>
                                    {model.id !== 'auto' && (
                                        <Tag
                                            color={tag.color}
                                            style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
                                        >
                                            {tag.label}
                                        </Tag>
                                    )}
                                    {isSelected && <CheckOutlined className="model-option-check" style={{ fontSize: 11, color: 'var(--ant-color-primary)' }} />}
                                </div>
                            </Tooltip>
                        </Option>
                    );
                })}
            </Select>
            </Tooltip>
        );
    }

    // ── Full (settings) mode ──────────────────────────────────────────────────
    return (
        <Card
            title={<Space><ExperimentOutlined /> {t('ai_model_selection')}</Space>}
            size="small"
            className={className}
            extra={
                <Button size="small" onClick={loadModels} loading={loading} icon={<ThunderboltOutlined />}>
                    {t('refresh')}
                </Button>
            }
        >
            <Space direction="vertical" style={{ width: '100%' }}>
                <Select
                    value={selectedModel}
                    onChange={onSelect}
                    loading={loading}
                    disabled={disabled}
                    style={{ width: '100%' }}
                    placeholder={t('select_ai_model')}
                    optionLabelProp="label"
                    popupMatchSelectWidth={false}
                    dropdownRender={menu => (
                        <div>
                            {menu}
                            <div style={{ padding: '8px', borderTop: '1px solid #f0f0f0' }}>
                                <Button
                                    type="link"
                                    size="small"
                                    icon={<SettingOutlined />}
                                    onClick={() => window.location.href = '/settings?tab=api-keys'}
                                    style={{ width: '100%' }}
                                >
                                    {t('ai_model_settings')}
                                </Button>
                            </div>
                        </div>
                    )}
                >
                    {allModels.map(model => {
                        const providerColor = PROVIDER_COLORS[model.provider] || '#6b7280';
                        const icon = <ProviderLogo provider={model.provider} size={18} />;
                        const tag = categoryTag(model);
                        const isDefault = model.id === serverDefault;
                        return (
                            <Option
                                key={model.id}
                                value={model.id}
                                disabled={!model.available}
                                label={
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ color: providerColor }}>{icon}</span>
                                        <span>{model.name}</span>
                                        {model.is_local && (
                                            <Tag color="purple" style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>{t('local')}</Tag>
                                        )}
                                    </span>
                                }
                            >
                                <Tooltip
                                    title={
                                        <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 280 }}>
                                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{model.name}</div>
                                            <div style={{ opacity: 0.85 }}>{model.description}</div>
                                        </div>
                                    }
                                    placement="right"
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                                        <span style={{ color: model.available ? providerColor : '#9ca3af', fontSize: 16, flexShrink: 0 }}>
                                            {icon}
                                        </span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: model.available ? 1 : 0.45 }}>
                                                <Text strong={selectedModel === model.id} style={{ fontSize: 13 }}>{model.name}</Text>
                                                {model.id !== 'auto' && (
                                                    <Tag
                                                        color={tag.color}
                                                        style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
                                                    >
                                                        {tag.label}
                                                    </Tag>
                                                )}
                                                {isDefault && (
                                                    <CrownOutlined style={{ color: '#f59e0b', fontSize: 11 }} title={t('platform_default')} />
                                                )}
                                                {model.id !== 'auto' && modelStatus[model.id] !== undefined && (
                                                    modelStatus[model.id]?.success
                                                        ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 11 }} />
                                                        : <ExclamationCircleOutlined style={{ color: '#ff4d4f', fontSize: 11 }} />
                                                )}
                                            </div>
                                            <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.4 }}>
                                                {model.available
                                                    ? (model.description || FALLBACK_DESC[model.id] || '')
                                                    : t('model_not_configured')}
                                            </div>
                                        </div>
                                        {showCostInfo && model.cost_per_1k_tokens === 0 && model.available && model.id !== 'auto' && (
                                            <Tag color="green" style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>{t('free')}</Tag>
                                        )}
                                    </div>
                                </Tooltip>
                            </Option>
                        );
                    })}
                </Select>

                {selectedModel && selectedModel !== 'auto' && (
                    <div>
                        <Text type="secondary">{t('status')}: </Text>
                        <Badge
                            status={
                                modelStatus[selectedModel]?.available === false
                                    ? 'error'
                                    : modelStatus[selectedModel]?.success === false
                                      ? 'error'
                                      : 'success'
                            }
                            text={allModels.find(m => m.id === selectedModel)?.name || selectedModel}
                        />
                    </div>
                )}

                {selectedModel?.startsWith('byok_') && modelStatus[selectedModel]?.available === false && (
                    <Alert
                        type="warning"
                        showIcon
                        message={t('api_key_model_invalid')}
                        description={
                            <>
                                {t('update_key_model_under')}{' '}
                                <a href="/settings?tab=api-keys">Settings → API Keys → AI Provider Keys</a>.
                            </>
                        }
                    />
                )}

                {models.some(m => !m.available) && (
                    <Alert
                        message={t('some_models_unavailable')}
                        description={t('configure_api_keys_enable_models')}
                        type="warning"
                        showIcon
                    />
                )}

                {models.length > 0 && models.some(m => m.is_local) && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                        {t('local_models_available_hint')} <code>AISER_PRIVATE_MODELS</code> {t('or')} <code>OLLAMA_*</code> {t('env_vars_add_more')}.
                    </Text>
                )}
            </Space>
        </Card>
    );
};

// Named export so it can be used with dynamic import .then(m => m.ModelSelector)
export { ModelSelector };
export default ModelSelector;
