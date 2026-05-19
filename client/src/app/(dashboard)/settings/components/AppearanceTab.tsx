import React, { useEffect } from 'react';
import { Card, Form, Button, message, Space, Divider, Typography } from 'antd';
import { GlobalOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { AppearanceForm } from './forms/AppearanceForm';

const { Title, Text } = Typography;

export const AppearanceTab: React.FC = () => {
  const t = useTranslations('settings');
  const [form] = Form.useForm();
  const { appearanceSettings, loading, updateAppearanceSettings } = useSettingsStore();

  // Data fetching is now handled by the parent SettingsPage based on active tab

  useEffect(() => {
    if (appearanceSettings) {
      form.setFieldsValue({
        compact_mode: appearanceSettings.compact_mode ?? false,
        number_format: appearanceSettings.number_format || '1,234.56',
      });
    }
  }, [appearanceSettings, form]);

  const handleSubmit = async (values: any) => {
    try {
      await updateAppearanceSettings(values);
      message.success(t('appearance_update_success'));
      message.info(t('appearance_refresh_hint'));
    } catch (error: any) {
      message.error(error?.message || t('appearance_update_failed'));
    }
  };

  return (
    <Card
      title={
        <Space>
          <GlobalOutlined />
          {t('appearance_title')}
        </Space>
      }
      extra={
        <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={loading}>
          {t('save_changes')}
        </Button>
      }
    >
      <div style={{ marginBottom: 24 }}>
        <Title level={5}>{t('appearance_customize_title')}</Title>
        <Text type="secondary">{t('appearance_customize_desc')}</Text>
      </div>

      <AppearanceForm form={form} onFinish={handleSubmit} />

      <Divider />

      <Text type="secondary" style={{ fontSize: '12px' }}>
        {t('appearance_refresh_hint')}
      </Text>
    </Card>
  );
};
