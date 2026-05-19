import React from 'react';
import { Form, Switch, Select, Space, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { SecurityFormValues } from '../../types';

const { Text } = Typography;
const { Option } = Select;

interface SecurityFormProps {
  form: any;
  initialValues?: Partial<SecurityFormValues>;
  onFinish: (values: SecurityFormValues) => void;
  disabled?: boolean;
}

export const SecurityForm: React.FC<SecurityFormProps> = ({ 
  form, 
  initialValues, 
  onFinish, 
  disabled = false 
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
            <Text strong>{t('security_two_factor_title')}</Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {t('security_two_factor_desc')}
            </Text>
          </Space>
        }
        name="two_factor_enabled"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>

      <Form.Item
        label={
          <Space direction="vertical" size={0}>
            <Text strong>{t('security_session_timeout_title')}</Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {t('security_session_timeout_desc')}
            </Text>
          </Space>
        }
        name="session_timeout"
      >
        <Select placeholder={t('security_session_timeout_placeholder')}>
          <Option value={15}>{t('security_timeout_15m')}</Option>
          <Option value={30}>{t('security_timeout_30m')}</Option>
          <Option value={60}>{t('security_timeout_1h')}</Option>
          <Option value={120}>{t('security_timeout_2h')}</Option>
          <Option value={240}>{t('security_timeout_4h')}</Option>
          <Option value={480}>{t('security_timeout_8h')}</Option>
          <Option value={0}>{t('security_timeout_never')}</Option>
        </Select>
      </Form.Item>

      <Form.Item
        label={
          <Space direction="vertical" size={0}>
            <Text strong>{t('security_login_notifications_title')}</Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {t('security_login_notifications_desc')}
            </Text>
          </Space>
        }
        name="login_notifications"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>

      <Form.Item
        label={
          <Space direction="vertical" size={0}>
            <Text strong>{t('security_suspicious_title')}</Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {t('security_suspicious_desc')}
            </Text>
          </Space>
        }
        name="suspicious_activity_alerts"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>
    </Form>
  );
};
