import React from 'react';
import { Form, Switch, Space, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { NotificationFormValues } from '../../types';

const { Text } = Typography;

interface NotificationFormProps {
  form: any;
  initialValues?: Partial<NotificationFormValues>;
  onFinish: (values: NotificationFormValues) => void;
  disabled?: boolean;
}

export const NotificationForm: React.FC<NotificationFormProps> = ({
  form,
  initialValues,
  onFinish,
  disabled = false,
}) => {
  const t = useTranslations('settings');
  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={onFinish}
      initialValues={initialValues}
      disabled={disabled}
    >
      <Form.Item
        label={
          <Space direction="vertical" size={0}>
            <Text strong>{t('notif_email_title')}</Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {t('notif_email_desc')}
            </Text>
          </Space>
        }
        name="email_notifications"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>

      <Form.Item
        label={
          <Space direction="vertical" size={0}>
            <Text strong>{t('notif_push_title')}</Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {t('notif_push_desc')}
            </Text>
          </Space>
        }
        name="push_notifications"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>
    </Form>
  );
};
