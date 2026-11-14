'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, QRCode, Space, Tag, Typography, message } from 'antd';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';

type Status = { enabled: boolean; has_password: boolean; backup_codes_left: number };
type Enrollment = { secret: string; otpauth_uri: string };

const { Text, Paragraph } = Typography;

/** Turn the authenticator step on or off for this account. */
export function TwoFactorSetting() {
  const t = useTranslations('settings');
  const [status, setStatus] = useState<Status | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetchApi('/api/auth/2fa/status').then((s) => setStatus(s as Status)).catch(() => setStatus(null));
  }, []);
  useEffect(load, [load]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setEntry('');
    try {
      setEnrollment((await fetchApi('/api/auth/2fa/enroll/start', { method: 'POST', body: '{}' })) as Enrollment);
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('two_factor_failed'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = (await fetchApi('/api/auth/2fa/enroll/confirm', {
        method: 'POST',
        body: JSON.stringify({ code: entry }),
      })) as { backup_codes: string[] };
      setEnrollment(null);
      setBackupCodes(res.backup_codes);
      load();
    } catch {
      setError(t('two_factor_wrong_code'));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetchApi('/api/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify(status?.has_password ? { password: entry } : { code: entry }),
      });
      setTurningOff(false);
      setEntry('');
      message.success(t('two_factor_off_done'));
      load();
    } catch {
      setError(status?.has_password ? t('two_factor_wrong_password') : t('two_factor_wrong_code'));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 24 }}>
      <Space orientation="vertical" size={0}>
        <Space size={8}>
          <Text strong>{t('security_two_factor_title')}</Text>
          {status.enabled ? <Tag color="success" bordered={false}>{t('two_factor_on')}</Tag> : null}
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {status.enabled ? t('two_factor_backup_left', { n: status.backup_codes_left }) : t('security_two_factor_desc')}
        </Text>
      </Space>
      {status.enabled ? (
        <Button onClick={() => { setEntry(''); setError(null); setTurningOff(true); }}>{t('two_factor_turn_off')}</Button>
      ) : (
        <Button loading={busy && !enrollment} onClick={() => void start()}>{t('two_factor_turn_on')}</Button>
      )}

      <Modal
        title={t('two_factor_setup_title')}
        open={Boolean(enrollment)}
        onCancel={() => setEnrollment(null)}
        onOk={() => void confirm()}
        okText={t('two_factor_confirm')}
        okButtonProps={{ disabled: entry.length !== 6 }}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Paragraph type="secondary">{t('two_factor_setup_desc')}</Paragraph>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          {enrollment ? <QRCode value={enrollment.otpauth_uri} size={176} bordered={false} /> : null}
        </div>
        <Paragraph type="secondary" style={{ textAlign: 'center' }}>
          {t('two_factor_manual')} <Text code copyable>{enrollment?.secret}</Text>
        </Paragraph>
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Input.OTP length={6} value={entry} onChange={setEntry} aria-label={t('two_factor_code')} />
        </div>
      </Modal>

      <Modal
        title={t('two_factor_codes_title')}
        open={Boolean(backupCodes)}
        onCancel={() => setBackupCodes(null)}
        onOk={() => setBackupCodes(null)}
        okText={t('two_factor_codes_saved')}
        cancelButtonProps={{ style: { display: 'none' } }}
        maskClosable={false}
        closable={false}
      >
        <Paragraph type="secondary">{t('two_factor_codes_desc')}</Paragraph>
        <Paragraph copyable={{ text: (backupCodes ?? []).join('\n') }}>
          <pre style={{ margin: 0, columns: 2 }}>{(backupCodes ?? []).join('\n')}</pre>
        </Paragraph>
      </Modal>

      <Modal
        title={t('two_factor_off_title')}
        open={turningOff}
        onCancel={() => setTurningOff(false)}
        onOk={() => void turnOff()}
        okText={t('two_factor_turn_off')}
        okButtonProps={{ danger: true, disabled: !entry }}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Paragraph type="secondary">{status.has_password ? t('two_factor_off_password') : t('two_factor_off_code')}</Paragraph>
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
        {status.has_password ? (
          <Input.Password value={entry} onChange={(e) => setEntry(e.target.value)} autoComplete="current-password" aria-label={t('two_factor_off_title')} />
        ) : (
          <Input.OTP length={6} value={entry} onChange={setEntry} aria-label={t('two_factor_code')} />
        )}
      </Modal>
    </div>
  );
}
