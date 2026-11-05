'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { App, Form, Input, InputNumber, Modal, Radio, Select, Switch, Typography } from 'antd';
import { fetchApi } from '@/utils/api';

type Compliance = {
  audit_retention_days: number | null;
  legal_hold: boolean;
  siem: { url?: string | null; format: 'json' | 'splunk_hec'; connected: boolean; last_sent_at?: string | null; last_error?: string | null };
};

/** Audit log › Compliance: stream events to a SIEM, how long the log is kept, and legal hold. */
export function ComplianceSettingsModal({ open, organizationId, onClose }: { open: boolean; organizationId?: string; onClose: () => void }) {
  const t = useTranslations('settings.audit');
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [state, setState] = useState<Compliance | null>(null);
  const [saving, setSaving] = useState(false);
  const keepForever = Form.useWatch('keep', form) !== 'days';

  useEffect(() => {
    if (!open || !organizationId) return;
    fetchApi<Compliance>(`platform/compliance?organization_id=${encodeURIComponent(organizationId)}`)
      .then((c) => {
        setState(c);
        form.setFieldsValue({
          keep: c.audit_retention_days ? 'days' : 'forever',
          audit_retention_days: c.audit_retention_days ?? 365,
          legal_hold: c.legal_hold,
          siem_url: c.siem.url ?? '',
          siem_format: c.siem.format,
          siem_token: '',
        });
      })
      .catch((e) => message.error(e instanceof Error ? e.message : t('load_error')));
  }, [open, organizationId, form, message, t]);

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      setState(await fetchApi<Compliance>(`platform/compliance?organization_id=${encodeURIComponent(String(organizationId))}`, {
        method: 'PUT',
        body: JSON.stringify({
          audit_retention_days: v.keep === 'days' ? v.audit_retention_days : null,
          legal_hold: v.legal_hold,
          siem: { url: v.siem_url || null, format: v.siem_format, token: v.siem_token || null },
        }),
      }));
      message.success(t('compliance_saved'));
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('load_error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={t('compliance_title')} onOk={() => void save()} confirmLoading={saving} onCancel={onClose} okText={t('compliance_save')} destroyOnHidden>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item label={t('retention_label')} name="keep">
          <Radio.Group options={[{ value: 'forever', label: t('retention_forever') }, { value: 'days', label: t('retention_days') }]} />
        </Form.Item>
        {!keepForever ? (
          <Form.Item name="audit_retention_days" extra={t('retention_min')}>
            <InputNumber min={365} max={3650} addonAfter={t('days')} />
          </Form.Item>
        ) : null}
        <Form.Item name="legal_hold" label={t('legal_hold')} valuePropName="checked" extra={t('legal_hold_hint')}>
          <Switch />
        </Form.Item>
        <Form.Item label={t('siem_url')} name="siem_url" extra={t('siem_hint')}>
          <Input placeholder="https://http-inputs.example.splunkcloud.com/services/collector" />
        </Form.Item>
        <Form.Item label={t('siem_format')} name="siem_format">
          <Select options={[{ value: 'json', label: 'JSON' }, { value: 'splunk_hec', label: 'Splunk HEC' }]} />
        </Form.Item>
        <Form.Item label={t('siem_token')} name="siem_token" extra={state?.siem.connected ? t('siem_token_keep') : undefined}>
          <Input.Password autoComplete="off" />
        </Form.Item>
        {state?.siem.connected ? (
          state.siem.last_error ? (
            <Typography.Text type="danger">{t('siem_error', { error: state.siem.last_error })}</Typography.Text>
          ) : state.siem.last_sent_at ? (
            <Typography.Text type="secondary">{t('siem_last_sent', { when: new Date(state.siem.last_sent_at).toLocaleString() })}</Typography.Text>
          ) : null
        ) : null}
      </Form>
    </Modal>
  );
}
