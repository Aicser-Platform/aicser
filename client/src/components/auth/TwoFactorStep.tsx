'use client';

import React, { useState } from 'react';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { clearPendingTwoFactor, verifyTwoFactor } from '@/auth/twoFactor';

/** Sign-in's second step: the authenticator code, or a backup code. */
export function TwoFactorStep({ loginToken, onDone, onCancel }: { loginToken: string; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations('auth');
  const [form] = Form.useForm<{ entry: string }>();
  const [useBackup, setUseBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value: string) => {
    const entry = value.trim();
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTwoFactor(loginToken, useBackup ? { backup_code: entry } : { code: entry });
      onDone();
    } catch (e) {
      const detail = e instanceof Error ? e.message : '';
      // An expired or used-up attempt can't be retried here.
      if (/expired|too many/i.test(detail)) {
        clearPendingTwoFactor();
        onCancel();
      }
      form.resetFields(); // ready for the next try
      setError(/expired|too many/i.test(detail) ? t('two_factor_expired') : t('two_factor_wrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form form={form} layout="vertical" requiredMark={false} onFinish={(v: { entry: string }) => void submit(v.entry)}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>{t('two_factor_title')}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {useBackup ? t('two_factor_backup_desc') : t('two_factor_desc')}
      </Typography.Paragraph>
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
      <Form.Item name="entry" rules={[{ required: true, message: t('two_factor_required') }]}>
        {useBackup ? (
          <Input autoFocus autoComplete="off" aria-label={t('two_factor_backup_label')} />
        ) : (
          <Input.OTP length={6} autoFocus aria-label={t('two_factor_code_label')} />
        )}
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={busy}>{t('two_factor_verify')}</Button>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <Button type="link" style={{ paddingInline: 0 }} onClick={() => { setUseBackup((v) => !v); setError(null); }}>
          {useBackup ? t('two_factor_use_app') : t('two_factor_use_backup')}
        </Button>
        <Button type="link" style={{ paddingInline: 0 }} onClick={() => { clearPendingTwoFactor(); onCancel(); }}>
          {t('two_factor_back')}
        </Button>
      </div>
    </Form>
  );
}
