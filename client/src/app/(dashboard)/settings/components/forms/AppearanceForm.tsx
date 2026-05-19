import React from 'react';
import { Form, Switch, Select, Space, Typography } from 'antd';
import { AppearanceFormValues } from '../../types';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

const { Text } = Typography;
const { Option } = Select;

interface AppearanceFormProps {
  form: any;
  initialValues?: Partial<AppearanceFormValues>;
  onFinish: (values: AppearanceFormValues) => void;
  disabled?: boolean;
}

/** Display-only preferences. Theme, language, and date format live in General to avoid duplication. */
export const AppearanceForm: React.FC<AppearanceFormProps> = ({
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
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('appearance_general_settings_hint')} <Link href="/settings?tab=general">{t('tab_general')}</Link>.
        </Text>
      </div>

      <Form.Item
        label={
          <Space direction="vertical" size={0}>
            <Text strong>{t('appearance_compact_mode')}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('appearance_compact_mode_desc')}
            </Text>
          </Space>
        }
        name="compact_mode"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>

      <Form.Item
        label={
          <Space direction="vertical" size={0}>
            <Text strong>{t('appearance_number_format')}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('appearance_number_format_desc')}
            </Text>
          </Space>
        }
        name="number_format"
      >
        <Select placeholder={t('appearance_select_number_format')}>
          <Option value="1,234.56">{t('appearance_number_format_us')}</Option>
          <Option value="1.234,56">{t('appearance_number_format_eu')}</Option>
          <Option value="1 234.56">{t('appearance_number_format_space')}</Option>
        </Select>
      </Form.Item>
    </Form>
  );
};
