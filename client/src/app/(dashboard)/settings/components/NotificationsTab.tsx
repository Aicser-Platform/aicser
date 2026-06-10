import React, { useEffect } from 'react';
import { Card, Form, Button, message, Divider, Typography } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { NotificationForm } from './forms/NotificationForm';
import type { TabComponentProps } from '../page';

const { Title, Text } = Typography;

export const NotificationsTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('settings');
  const [form] = Form.useForm();
  const { notificationSettings, loading, updateNotificationSettings } = useSettingsStore();

  useEffect(() => {
    onSetAction?.(
      <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={loading}>
        {t('save_changes')}
      </Button>
    );
  }, [loading, onSetAction]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data fetching is now handled by the parent SettingsPage based on active tab

  useEffect(() => {
    if (notificationSettings) {
      form.setFieldsValue({
        email_notifications: notificationSettings.email_notifications !== false,
        push_notifications: notificationSettings.push_notifications !== false,
      });
    }
  }, [notificationSettings, form]);

  const handleSubmit = async (values: any) => {
    try {
      await updateNotificationSettings(values);
      message.success(t('notifications_update_success'));
    } catch (error: any) {
      message.error(error?.message || t('notifications_update_failed'));
    }
  };

  return (
    <Card
      size="small"
      bordered={false}
      style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}
    >
      <div style={{ marginBottom: 20 }}>
        <Title level={5} style={{ margin: 0 }}>{t('notifications_communication_preferences')}</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>{t('notifications_section_sub')}</Text>
      </div>

      <NotificationForm form={form} onFinish={handleSubmit} />

      <Divider />

      <Text type="secondary" style={{ fontSize: '12px' }}>
        {t('notifications_critical_note')}
      </Text>
    </Card>
  );
};
