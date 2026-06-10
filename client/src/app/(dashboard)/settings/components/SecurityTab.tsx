import React, { useEffect } from 'react';
import { Card, Form, Button, message, Alert } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { SecurityForm } from './forms/SecurityForm';
import type { TabComponentProps } from '../page';

export const SecurityTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('settings');
  const [form] = Form.useForm();
  const { securitySettings, loading, updateSecuritySettings } = useSettingsStore();

  useEffect(() => {
    onSetAction?.(
      <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={loading}>
        {t('save_changes')}
      </Button>
    );
  }, [loading, onSetAction]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data fetching is now handled by the parent SettingsPage based on active tab

  useEffect(() => {
    if (securitySettings) {
      form.setFieldsValue({
        two_factor_enabled: securitySettings.two_factor_enabled || false,
        session_timeout: securitySettings.session_timeout || 60,
        login_notifications: securitySettings.login_notifications !== false,
        suspicious_activity_alerts: securitySettings.suspicious_activity_alerts !== false,
      });
    }
  }, [securitySettings, form]);

  const handleSubmit = async (values: any) => {
    try {
      await updateSecuritySettings(values);
      message.success(t('security_update_success'));
    } catch (error: any) {
      message.error(error?.message || t('security_update_failed'));
    }
  };

  return (
    <Card
      size="small"
      bordered={false}
      style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}
    >
      <Alert
        message={t('security_alert_title')}
        description={t('security_alert_desc')}
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />
      <SecurityForm form={form} onFinish={handleSubmit} />
    </Card>
  );
};
