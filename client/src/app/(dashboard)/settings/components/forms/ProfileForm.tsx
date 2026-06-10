import React from 'react';
import { Form, Input, Select } from 'antd';
import type { FormInstance } from 'antd';
import { UserOutlined, MailOutlined, PhoneOutlined, GlobalOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { ProfileFormValues } from '../../types';

const { TextArea } = Input;
const { Option } = Select;

interface ProfileFormProps {
  form: FormInstance<ProfileFormValues>;
  initialValues?: Partial<ProfileFormValues>;
  onFinish: (values: ProfileFormValues) => void;
  disabled?: boolean;
}

export const ProfileForm: React.FC<ProfileFormProps> = ({ form, initialValues, onFinish, disabled = false }) => {
  const t = useTranslations('settings');
  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={onFinish}
      initialValues={initialValues}
      disabled={disabled}
      className="w-full"
    >
      <div className="grid w-full grid-cols-1 gap-x-6 lg:grid-cols-2">
        <Form.Item
          name="first_name"
          label={t('profile_first_name')}
          rules={[{ required: true, message: t('profile_first_name_required') }]}
        >
          <Input className="w-full" prefix={<UserOutlined />} placeholder={t('profile_first_name')} />
        </Form.Item>
        <Form.Item name="last_name" label={t('profile_last_name')}>
          <Input className="w-full" prefix={<UserOutlined />} placeholder={t('profile_last_name')} />
        </Form.Item>
        <Form.Item
          name="email"
          label={t('profile_email')}
          rules={[
            { required: true, message: t('profile_email_required') },
            { type: 'email', message: t('profile_email_invalid') },
          ]}
        >
          <Input className="w-full" prefix={<MailOutlined />} placeholder={t('profile_email_placeholder')} disabled />
        </Form.Item>
        <Form.Item name="username" label={t('profile_username')}>
          <Input className="w-full" prefix={<UserOutlined />} placeholder={t('profile_username_placeholder')} />
        </Form.Item>
        <Form.Item name="phone_number" label={t('profile_phone')}>
          <Input className="w-full" prefix={<PhoneOutlined />} placeholder={t('profile_phone')} />
        </Form.Item>
        <Form.Item name="company" label={t('profile_company')}>
          <Input className="w-full" placeholder={t('profile_company')} />
        </Form.Item>
        <Form.Item name="location" label={t('profile_location')}>
          <Input className="w-full" prefix={<GlobalOutlined />} placeholder={t('profile_location_placeholder')} />
        </Form.Item>
        <Form.Item name="timezone" label={t('timezone')}>
          <Select className="w-full" placeholder={t('select_timezone')}>
            <Option value="America/New_York">{t('tz_eastern')}</Option>
            <Option value="America/Chicago">{t('tz_central')}</Option>
            <Option value="America/Denver">{t('tz_mountain')}</Option>
            <Option value="America/Los_Angeles">{t('tz_pacific')}</Option>
            <Option value="Europe/London">{t('tz_london')}</Option>
            <Option value="Europe/Paris">{t('tz_paris')}</Option>
            <Option value="Asia/Tokyo">{t('tz_tokyo')}</Option>
            <Option value="Asia/Shanghai">{t('tz_shanghai')}</Option>
          </Select>
        </Form.Item>
        <Form.Item name="job_role" label={t('profile_job_role')}>
          <Input className="w-full" placeholder={t('profile_job_role')} />
        </Form.Item>
        <Form.Item name="industry" label={t('profile_industry')}>
          <Input className="w-full" placeholder={t('profile_industry')} />
        </Form.Item>
        <Form.Item name="company_size" label={t('profile_company_size')}>
          <Select className="w-full" placeholder={t('profile_select_company_size')}>
            <Option value="1-10">1-10</Option>
            <Option value="11-50">11-50</Option>
            <Option value="51-200">51-200</Option>
            <Option value="201-1000">201-1000</Option>
            <Option value="1000+">1000+</Option>
          </Select>
        </Form.Item>
        <Form.Item name="data_experience" label={t('profile_data_experience')}>
          <Select className="w-full" placeholder={t('profile_select_experience_level')}>
            <Option value="beginner">{t('profile_experience_beginner')}</Option>
            <Option value="intermediate">{t('profile_experience_intermediate')}</Option>
            <Option value="advanced">{t('profile_experience_advanced')}</Option>
            <Option value="expert">{t('profile_experience_expert')}</Option>
          </Select>
        </Form.Item>
        <Form.Item name="primary_use_case" label={t('profile_primary_use_case')}>
          <Input className="w-full" placeholder={t('profile_primary_use_case')} />
        </Form.Item>
        <Form.Item name="data_frequency" label={t('profile_data_frequency')}>
          <Select className="w-full" placeholder={t('profile_select_frequency')}>
            <Option value="daily">{t('profile_frequency_daily')}</Option>
            <Option value="weekly">{t('profile_frequency_weekly')}</Option>
            <Option value="monthly">{t('profile_frequency_monthly')}</Option>
            <Option value="occasionally">{t('profile_frequency_occasionally')}</Option>
          </Select>
        </Form.Item>
      </div>

      <Form.Item name="bio" label={t('profile_bio')}>
        <TextArea className="w-full" rows={4} placeholder={t('profile_bio_placeholder')} maxLength={500} showCount />
      </Form.Item>
    </Form>
  );
};
