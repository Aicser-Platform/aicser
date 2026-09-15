'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  App,
  Alert,
  Button,
  Checkbox,
  ColorPicker,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Slider,
  Space,
  Switch,
  Tabs,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { handleUpgradeRequiredError } from '@/utils/api';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useKnowledgeLibraries } from '@/hooks/useKnowledgeLibraries';
import { useDataSources } from '@/hooks/useDataSources';
import type {
  EmbedAssistantPayload,
  EmbedAssistantRecord,
  EmbedAssistantVisibility,
} from '../../types';
import { EmbedAssistantSharePanel } from './EmbedAssistantSharePanel';
import { asDynamicComponent } from '@/utils/asDynamicModule';

// Dynamic + ssr:false, same as ApiKeysTab.tsx — ModelSelector's "full" (non-compact)
// mode reads from a client-only preference/localStorage path.
const ModelSelectorFallback = () => null;
const ModelSelector = dynamic(
  () =>
    import('@/components/ai/ModelSelector/ModelSelector').then((m) =>
      asDynamicComponent(m.ModelSelector ?? m.default, ModelSelectorFallback),
    ),
  { ssr: false },
);

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

const MAX_STARTERS = 6;

// Mirrors client/ee/src/ee/app/(dashboard)/chat/constants.ts's mode keys and
// FRONTEND_MODE_LABELS — duplicated rather than imported because this file
// must stay buildable in CE (ee/ is stripped there), while embed assistants
// are EE-only. Keep the key set and labels in sync if that file's canon
// changes.
//
// "rag_only" assistants have no data-source query engine wired up, so any
// mode needing SQL/analytics (diagnostic, predictive, dashboards, etc.)
// would just fail at request time if allowed — this used to offer a fixed,
// stale 3-option list (including a "deep" value that isn't a real mode at
// all) regardless of which capability was picked. Gating the option list by
// capability keeps the two fields honest with each other.
const RAG_ONLY_MODES = ['conversational', 'ai_search'] as const;
const FULL_ENGINE_ONLY_MODES = [
  'auto',
  'standard',
  'diagnostic',
  'predictive',
  'prescriptive',
  'animate',
  'executive_report',
  'decision_intelligence',
  'dashboard',
  'business_journey',
] as const;
const EMBED_MODE_LABELS: Record<string, string> = {
  auto: 'Auto',
  conversational: 'Chat',
  standard: 'Analyze',
  diagnostic: 'Diagnostic',
  predictive: 'Predictive',
  prescriptive: 'Prescriptive',
  animate: 'Animate',
  executive_report: 'Executive report',
  decision_intelligence: 'Decide',
  dashboard: 'Dashboard',
  ai_search: 'Search docs',
  business_journey: 'Business OS',
};

function allowedModeOptions(capabilities: string | undefined): { value: string; label: string }[] {
  const keys: readonly string[] =
    capabilities === 'full_engine' ? [...RAG_ONLY_MODES, ...FULL_ENGINE_ONLY_MODES] : RAG_ONLY_MODES;
  return keys.map((value) => ({ value, label: EMBED_MODE_LABELS[value] ?? value }));
}

interface EmbedAssistantModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  organizationId?: string;
  assistant?: EmbedAssistantRecord | null;
  onClose: () => void;
}

interface FormValues {
  name: string;
  capabilities: string;
  allowed_modes?: string[];
  library_ids?: string[];
  data_source_ids?: string[];
  allowed_domains?: string;
  auth_mode?: string;
  welcome_message?: string;
  system_prompt?: string;
  fallback_message?: string;
  hide_aicser_branding?: boolean;
}

export const EmbedAssistantModal: React.FC<EmbedAssistantModalProps> = ({
  open,
  mode,
  organizationId,
  assistant,
  onClose,
}) => {
  const t = useTranslations('settings');
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const { libraries, isLoading: librariesLoading } = useKnowledgeLibraries(organizationId);
  const { dataSources, isLoading: dataSourcesLoading } = useDataSources();
  const { loading, createEmbedAssistant, updateEmbedAssistant } = useSettingsStore();

  const isEdit = mode === 'edit' && !!assistant?.id;

  const [activeTab, setActiveTab] = useState('identity');
  // Kept outside the Form (like OrganizationTab's ColorPicker usage) since its
  // Form-bound value would be an internal Color object, not the plain hex
  // string we store; the model selector and starter list similarly don't map
  // cleanly onto plain Form.Item values.
  const [iconEmoji, setIconEmoji] = useState('');
  const [color, setColor] = useState<string | undefined>(undefined);
  const [preferredModel, setPreferredModel] = useState('auto');
  const [useCustomTemperature, setUseCustomTemperature] = useState(false);
  const [temperature, setTemperature] = useState(1);
  const [starters, setStarters] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<EmbedAssistantVisibility>('private');
  const capabilitiesValue = Form.useWatch('capabilities', form);
  const modeOptions = useMemo(() => allowedModeOptions(capabilitiesValue), [capabilitiesValue]);

  // Downgrading rag_only <-> full_engine can leave allowed_modes holding a
  // value the new capability doesn't support (e.g. "diagnostic" surviving a
  // switch to rag_only) — prune rather than let the form silently submit a
  // mode the assistant can no longer actually serve.
  const handleCapabilitiesChange = (value: string) => {
    const validKeys = new Set(allowedModeOptions(value).map((o) => o.value));
    const current: string[] = form.getFieldValue('allowed_modes') || [];
    const pruned = current.filter((m) => validKeys.has(m));
    form.setFieldValue('allowed_modes', pruned.length ? pruned : ['ai_search']);
  };

  useEffect(() => {
    if (!open) return;
    setActiveTab('identity');
    if (isEdit && assistant) {
      form.setFieldsValue({
        name: assistant.name,
        capabilities: assistant.capabilities || 'rag_only',
        allowed_modes: assistant.allowed_modes?.length ? assistant.allowed_modes : ['ai_search'],
        library_ids: assistant.library_ids || [],
        data_source_ids: assistant.data_source_ids?.length
          ? assistant.data_source_ids
          : assistant.primary_data_source_id
            ? [assistant.primary_data_source_id]
            : [],
        allowed_domains: (assistant.allowed_domains || []).join(', '),
        auth_mode: assistant.auth_mode || 'session',
        welcome_message: assistant.welcome_message || '',
        system_prompt: assistant.system_prompt || '',
        fallback_message: assistant.fallback_message || '',
        hide_aicser_branding: assistant.hide_aicser_branding || false,
      });
      setIconEmoji(assistant.icon_emoji || '');
      setColor(assistant.color || undefined);
      setPreferredModel(assistant.preferred_model || 'auto');
      setUseCustomTemperature(assistant.temperature != null);
      setTemperature(assistant.temperature ?? 1);
      setStarters(assistant.conversation_starters || []);
      setVisibility(assistant.visibility || 'private');
    } else {
      form.resetFields();
      form.setFieldsValue({
        capabilities: 'rag_only',
        allowed_modes: ['ai_search'],
        auth_mode: 'session',
        hide_aicser_branding: false,
      });
      setIconEmoji('');
      setColor(undefined);
      setPreferredModel('auto');
      setUseCustomTemperature(false);
      setTemperature(1);
      setStarters([]);
      setVisibility('private');
    }
  }, [open, isEdit, assistant, form]);

  const handleAddStarter = () => {
    if (starters.length >= MAX_STARTERS) return;
    setStarters((prev) => [...prev, '']);
  };
  const handleStarterChange = (index: number, value: string) => {
    setStarters((prev) => prev.map((s, i) => (i === index ? value : s)));
  };
  const handleRemoveStarter = (index: number) => {
    setStarters((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (values: FormValues) => {
    if (!isEdit && !organizationId) return;
    const domains = (values.allowed_domains || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    const dataSourceIds = values.data_source_ids || [];
    const cleanStarters = starters.map((s) => s.trim()).filter(Boolean).slice(0, MAX_STARTERS);

    const payload: EmbedAssistantPayload = {
      name: values.name,
      capabilities: values.capabilities as EmbedAssistantPayload['capabilities'],
      library_ids: values.library_ids || [],
      allowed_modes: values.allowed_modes?.length ? values.allowed_modes : ['ai_search'],
      allowed_domains: domains,
      auth_mode: (values.auth_mode || 'session') as EmbedAssistantPayload['auth_mode'],
      visibility,
      data_source_ids: dataSourceIds,
      primary_data_source_id: dataSourceIds[0] || undefined,
      system_prompt: values.system_prompt?.trim() || undefined,
      welcome_message: values.welcome_message?.trim() || undefined,
      fallback_message: values.fallback_message?.trim() || undefined,
      conversation_starters: cleanStarters,
      icon_emoji: iconEmoji.trim() || undefined,
      color: color || undefined,
      preferred_model: preferredModel && preferredModel !== 'auto' ? preferredModel : undefined,
      temperature: useCustomTemperature ? temperature : undefined,
      hide_aicser_branding: values.hide_aicser_branding || false,
    };

    try {
      if (isEdit && assistant) {
        await updateEmbedAssistant(assistant.id, payload);
        message.success(t('embed_assistant_updated'));
      } else {
        await createEmbedAssistant({ ...payload, organization_id: organizationId });
        message.success(t('embed_assistant_created'));
      }
      onClose();
    } catch (error) {
      if (handleUpgradeRequiredError(error)) return;
      message.error(
        error instanceof Error
          ? error.message
          : isEdit
            ? t('embed_assistant_update_failed')
            : t('embed_assistant_create_failed')
      );
    }
  };

  const identityTab = (
    <>
      <Form.Item
        name="name"
        label={t('embed_assistant_name')}
        rules={[{ required: true, message: t('embed_name_required') }]}
      >
        <Input maxLength={120} placeholder={t('embed_assistant_name')} />
      </Form.Item>
      <Form.Item label={t('embed_assistant_icon_label')} tooltip={t('embed_assistant_icon_help')}>
        <Space>
          <Input
            maxLength={8}
            placeholder="🤖"
            value={iconEmoji}
            onChange={(e) => setIconEmoji(e.target.value)}
            style={{ width: 72, textAlign: 'center', fontSize: 18 }}
          />
          <ColorPicker value={color || '#00c2cb'} onChange={(c) => setColor(c.toHexString())} showText size="middle" format="hex" />
        </Space>
      </Form.Item>
      <Form.Item
        name="welcome_message"
        label={t('embed_assistant_welcome_message')}
        extra={t('embed_assistant_welcome_message_help')}
      >
        <TextArea rows={2} maxLength={1000} placeholder={t('embed_assistant_welcome_message_placeholder')} />
      </Form.Item>
    </>
  );

  const behaviorTab = (
    <>
      <Form.Item
        name="system_prompt"
        label={t('embed_assistant_system_prompt')}
        extra={t('embed_assistant_system_prompt_help')}
      >
        <TextArea rows={6} maxLength={8000} placeholder={t('embed_assistant_system_prompt_placeholder')} />
      </Form.Item>
      <Form.Item
        name="fallback_message"
        label={t('embed_assistant_fallback_message')}
        extra={t('embed_assistant_fallback_message_help')}
      >
        <TextArea rows={2} maxLength={1000} placeholder={t('embed_assistant_fallback_message_placeholder')} />
      </Form.Item>
      <div>
        <Text strong style={{ fontSize: 13 }}>
          {t('embed_assistant_starters')}
        </Text>
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 2, marginBottom: 8 }}>
          {t('embed_assistant_starters_help')}
        </Paragraph>
        <Space orientation="vertical" style={{ width: '100%' }} size={6}>
          {starters.map((starter, index) => (
            <Space.Compact key={index} style={{ width: '100%' }}>
              <Input
                value={starter}
                maxLength={200}
                placeholder={t('embed_assistant_starter_placeholder')}
                onChange={(e) => handleStarterChange(index, e.target.value)}
              />
              <Button
                icon={<DeleteOutlined />}
                aria-label={t('embed_assistant_starter_remove')}
                onClick={() => handleRemoveStarter(index)}
              />
            </Space.Compact>
          ))}
        </Space>
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={handleAddStarter}
          disabled={starters.length >= MAX_STARTERS}
          style={{ marginTop: 8 }}
          block
        >
          {t('embed_assistant_starter_add')} ({starters.length}/{MAX_STARTERS})
        </Button>
      </div>
    </>
  );

  const intelligenceTab = (
    <>
      <Form.Item label={t('embed_assistant_preferred_model')} extra={t('embed_assistant_preferred_model_help')}>
        <ModelSelector value={preferredModel} onChange={setPreferredModel} showCostInfo={false} />
      </Form.Item>
      <Form.Item label={t('embed_assistant_temperature')}>
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Space>
            <Switch checked={useCustomTemperature} onChange={setUseCustomTemperature} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {useCustomTemperature
                ? t('embed_assistant_temperature_custom', { value: temperature.toFixed(1) })
                : t('embed_assistant_temperature_default')}
            </Text>
          </Space>
          {useCustomTemperature && (
            <Slider
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(v) => setTemperature(Array.isArray(v) ? v[0] : v)}
              marks={{ 0: '0', 1: '1', 2: '2' }}
            />
          )}
        </Space>
      </Form.Item>
      <Form.Item name="capabilities" label={t('embed_assistant_capabilities')} rules={[{ required: true }]}>
        <Select
          onChange={handleCapabilitiesChange}
          options={[
            { value: 'rag_only', label: t('embed_assistant_cap_rag') },
            { value: 'full_engine', label: t('embed_assistant_cap_full') },
          ]}
        />
      </Form.Item>
      <Form.Item
        name="allowed_modes"
        label={t('embed_assistant_modes')}
        extra={
          capabilitiesValue === 'full_engine'
            ? undefined
            : t('embed_assistant_modes_rag_only_hint')
        }
      >
        <Select mode="multiple" options={modeOptions} />
      </Form.Item>
    </>
  );

  const knowledgeTab = (
    <>
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
      <Form.Item
        name="data_source_ids"
        label={t('embed_assistant_data_sources')}
        extra={t('embed_assistant_data_sources_help')}
      >
        <Select
          mode="multiple"
          loading={dataSourcesLoading}
          placeholder={t('embed_assistant_data_sources')}
          options={dataSources.map((ds) => ({ value: ds.id, label: ds.name }))}
          allowClear
        />
      </Form.Item>
    </>
  );

  const accessTab = (
    <>
      <Form.Item
        name="auth_mode"
        label={t('embed_assistant_auth_mode')}
        extra={t('embed_assistant_auth_mode_help')}
      >
        <Select
          options={[
            { value: 'session', label: t('embed_assistant_auth_mode_session') },
            { value: 'embed_jwt', label: t('embed_assistant_auth_mode_embed_jwt') },
            { value: 'anonymous', label: t('embed_assistant_auth_mode_anonymous') },
          ]}
        />
      </Form.Item>
      <Form.Item label={t('embed_assistant_visibility')} extra={t('embed_assistant_visibility_help')}>
        <Radio.Group value={visibility} onChange={(e) => setVisibility(e.target.value)}>
          <Radio.Button value="private">{t('embed_assistant_visibility_private')}</Radio.Button>
          <Radio.Button value="shared">{t('embed_assistant_visibility_shared')}</Radio.Button>
          <Radio.Button value="public">{t('embed_assistant_visibility_public')}</Radio.Button>
        </Radio.Group>
      </Form.Item>
      {visibility === 'shared' &&
        (isEdit && assistant ? (
          <div style={{ marginBottom: 16 }}>
            <EmbedAssistantSharePanel assistantId={assistant.id} organizationId={organizationId} />
          </div>
        ) : (
          <Alert
            type="info"
            showIcon
            message={t('embed_assistant_share_save_first')}
            style={{ marginBottom: 16 }}
          />
        ))}
      <Form.Item
        name="allowed_domains"
        label={t('embed_assistant_domains')}
        extra={t('embed_assistant_domains_help')}
      >
        <Input placeholder="intranet.example.com, teams.microsoft.com" />
      </Form.Item>
      <Form.Item name="hide_aicser_branding" valuePropName="checked">
        <Checkbox>{t('embed_assistant_hide_branding')}</Checkbox>
      </Form.Item>
    </>
  );

  return (
    <Modal
      title={isEdit ? t('embed_assistant_edit_title', { name: assistant?.name || '' }) : t('embed_create_assistant')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(values) => void handleSubmit(values)}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: 'identity', label: t('embed_assistant_tab_identity'), children: identityTab },
            { key: 'behavior', label: t('embed_assistant_tab_behavior'), children: behaviorTab },
            { key: 'intelligence', label: t('embed_assistant_tab_intelligence'), children: intelligenceTab },
            { key: 'knowledge', label: t('embed_assistant_tab_knowledge'), children: knowledgeTab },
            { key: 'access', label: t('embed_assistant_tab_access'), children: accessTab },
          ]}
        />
        <Form.Item style={{ marginTop: 8, marginBottom: 0, textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>{t('cancel')}</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              {isEdit ? t('save') : t('embed_assistant_save_create')}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};
