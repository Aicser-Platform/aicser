'use client';

/**
 * AI data residency: which AI providers and hosts may process this organization's prompts
 * and data. Enforced server-side on every AI call; blocked models are skipped in favour of
 * allowed ones.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, App, Button, Card, Form, List, Select, Space, Switch, Tag, Typography } from 'antd';
import { fetchApi } from '@/utils/api';
import type { TabComponentProps } from '../page';

const { Paragraph } = Typography;

interface Policy {
  allowed_providers: string[];
  allowed_hosts: string[];
  decision_layer: boolean;
  deployment_default?: Record<string, unknown> | null;
  configured?: ConfiguredEndpoint[];
}

interface ConfiguredEndpoint {
  provider: string;
  host: string;
  example: string;
  allowed: boolean;
}

const PROVIDERS = ['azure', 'openai', 'anthropic', 'google', 'openrouter', 'groq', 'ollama'];
const PROVIDER_LABELS: Record<string, string> = {
  azure: 'Azure OpenAI',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google (Gemini)',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  ollama: 'Ollama (self-hosted)',
};

export default function AIResidencyTab(_: TabComponentProps) {
  const t = useTranslations('settings.residency');
  const { message } = App.useApp();
  const [form] = Form.useForm<Policy>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deploymentDefault, setDeploymentDefault] = useState<Record<string, unknown> | null>(null);
  const [configured, setConfigured] = useState<ConfiguredEndpoint[]>([]);
  const [blocksAll, setBlocksAll] = useState(false);
  const previewTimer = useRef<number | null>(null);

  // Live preview: the same server check every AI call uses, run on the policy being edited,
  // so the effect is visible before saving (not only as an error on Save).
  const preview = useCallback(() => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(async () => {
      try {
        const v = form.getFieldsValue();
        const res = await fetchApi<{ configured: ConfiguredEndpoint[]; blocks_all: boolean }>('api/ai-residency/preview', {
          method: 'POST',
          body: JSON.stringify({
            allowed_providers: v.allowed_providers || [],
            allowed_hosts: v.allowed_hosts || [],
            decision_layer: v.decision_layer !== false,
          }),
          headers: { 'Content-Type': 'application/json' },
        });
        setConfigured(res.configured || []);
        setBlocksAll(Boolean(res.blocks_all));
      } catch {
        /* preview is advisory; Save still validates */
      }
    }, 350);
  }, [form]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await fetchApi<Policy>('api/ai-residency');
      form.setFieldsValue({
        allowed_providers: p.allowed_providers || [],
        allowed_hosts: p.allowed_hosts || [],
        decision_layer: p.decision_layer !== false,
      });
      setDeploymentDefault(p.deployment_default || null);
      setConfigured(p.configured || []);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [form, message]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const res = await fetchApi<{ configured?: ConfiguredEndpoint[] }>('api/ai-residency', {
        method: 'PUT',
        body: JSON.stringify(v),
        headers: { 'Content-Type': 'application/json' },
      });
      setConfigured(res?.configured || []);
      message.success(t('saved'));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="small" loading={loading}>
      <Paragraph type="secondary">{t('desc')}</Paragraph>
      {deploymentDefault && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('deployment_default')} />
      )}
      <Form form={form} layout="vertical" style={{ maxWidth: 560 }} onValuesChange={preview}>
        <Form.Item name="allowed_providers" label={t('providers')} extra={t('providers_help')}>
          <Select
            mode="multiple"
            allowClear
            options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] || p }))}
            placeholder={t('any')}
          />
        </Form.Item>
        <Form.Item name="allowed_hosts" label={t('hosts')} extra={t('hosts_help')}>
          <Select mode="tags" tokenSeparators={[',', ' ']} placeholder={t('hosts_ph')} />
        </Form.Item>
        <Form.Item name="decision_layer" label={t('decision_layer')} valuePropName="checked" extra={t('decision_layer_help')}>
          <Switch />
        </Form.Item>
        {configured.length > 0 && (
          <Form.Item label={t('configured_title')} extra={t('configured_help')}>
            <List
              size="small"
              bordered
              dataSource={configured}
              renderItem={(e) => (
                <List.Item>
                  <Space direction="vertical" size={0}>
                    <span>{e.example}</span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {PROVIDER_LABELS[e.provider] || e.provider}
                      {e.host ? ` · ${e.host}` : ''}
                    </Typography.Text>
                  </Space>
                  <Tag color={e.allowed ? 'green' : 'red'}>{e.allowed ? t('allowed') : t('blocked')}</Tag>
                </List.Item>
              )}
            />
          </Form.Item>
        )}
        {blocksAll ? (
          <Alert type="error" showIcon style={{ marginBottom: 12 }} message={t('blocks_all')} />
        ) : null}
        <Space>
          <Button type="primary" loading={saving} onClick={save} disabled={blocksAll}>
            {t('save')}
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
