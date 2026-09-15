import React, { useMemo } from 'react';
import { Form, Input, Select } from 'antd';
import type { FormInstance } from 'antd';
import {
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  GlobalOutlined,
  BankOutlined,
  IdcardOutlined,
  ApartmentOutlined,
  TeamOutlined,
  TrophyOutlined,
  AimOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ProfileFormValues } from '../../types';
import { COUNTRY_OPTIONS } from '@/config/countries';
import { CountryFlagIcon } from '@/components/CountryFlagIcon/CountryFlagIcon';

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
  // Countries the user can currently pick from, plus (if the stored value predates
  // this dropdown - it used to be a free-text "City, Country" field) the raw legacy
  // value as one extra option, so a switch to a fixed list never makes an existing
  // profile's Location silently go blank.
  const currentLocation = Form.useWatch('location', form);
  const locationOptions = useMemo(() => {
    const known = COUNTRY_OPTIONS.map((c) => ({ value: c.name, code: c.code }));
    if (currentLocation && !COUNTRY_OPTIONS.some((c) => c.name === currentLocation)) {
      return [{ value: currentLocation, code: null as string | null }, ...known];
    }
    return known;
  }, [currentLocation]);
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
          <Input className="w-full" prefix={<BankOutlined />} placeholder={t('profile_company')} />
        </Form.Item>
        <Form.Item name="location" label={t('profile_location')}>
          <Select
            className="w-full"
            showSearch
            allowClear
            placeholder={t('profile_location_placeholder')}
            optionFilterProp="value"
            filterOption={(input, option) =>
              (option?.value as string)?.toLowerCase().includes(input.toLowerCase())
            }
          >
            {locationOptions.map(({ value, code }) => (
              <Option key={value} value={value}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {code ? (
                    <CountryFlagIcon countryCode={code} width={18} />
                  ) : (
                    <GlobalOutlined style={{ width: 18, textAlign: 'center', color: 'var(--ant-color-text-tertiary)' }} />
                  )}
                  {value}
                </span>
              </Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item name="job_role" label={t('profile_job_role')}>
          <Input className="w-full" prefix={<IdcardOutlined />} placeholder={t('profile_job_role')} />
        </Form.Item>
        <Form.Item name="industry" label={t('profile_industry')}>
          <Input className="w-full" prefix={<ApartmentOutlined />} placeholder={t('profile_industry')} />
        </Form.Item>
        <Form.Item name="company_size" label={t('profile_company_size')}>
          <Select className="w-full" prefix={<TeamOutlined />} placeholder={t('profile_select_company_size')}>
            <Option value="1-10">1-10</Option>
            <Option value="11-50">11-50</Option>
            <Option value="51-200">51-200</Option>
            <Option value="201-1000">201-1000</Option>
            <Option value="1000+">1000+</Option>
          </Select>
        </Form.Item>
        <Form.Item name="data_experience" label={t('profile_data_experience')}>
          <Select className="w-full" prefix={<TrophyOutlined />} placeholder={t('profile_select_experience_level')}>
            <Option value="beginner">{t('profile_experience_beginner')}</Option>
            <Option value="intermediate">{t('profile_experience_intermediate')}</Option>
            <Option value="advanced">{t('profile_experience_advanced')}</Option>
            <Option value="expert">{t('profile_experience_expert')}</Option>
          </Select>
        </Form.Item>
        <Form.Item name="primary_use_case" label={t('profile_primary_use_case')}>
          <Input className="w-full" prefix={<AimOutlined />} placeholder={t('profile_primary_use_case')} />
        </Form.Item>
        <Form.Item name="data_frequency" label={t('profile_data_frequency')}>
          <Select className="w-full" prefix={<ClockCircleOutlined />} placeholder={t('profile_select_frequency')}>
            <Option value="daily">{t('profile_frequency_daily')}</Option>
            <Option value="weekly">{t('profile_frequency_weekly')}</Option>
            <Option value="monthly">{t('profile_frequency_monthly')}</Option>
            <Option value="occasionally">{t('profile_frequency_occasionally')}</Option>
          </Select>
        </Form.Item>
      </div>

      {/* Timezone used to be a second, separately-editable field here — a genuine
          duplicate of General's timezone setting (a different backend field
          entirely, /users/profile vs /users/settings, with no sync between them
          and no shorter timezone list here ever actually consumed for date/time
          display anywhere in the app). Pointing here instead of re-adding an
          editable copy avoids reintroducing the same drift. */}
      <p className="mb-4 text-sm text-[var(--ant-color-text-secondary)]">
        {t('profile_timezone_moved_prefix')}{' '}
        <Link href="/settings?tab=general" className="text-[var(--ant-color-primary)] hover:underline">
          {t('profile_timezone_moved_link')}
        </Link>
      </p>

      <Form.Item name="bio" label={t('profile_bio')}>
        <TextArea className="w-full" rows={4} placeholder={t('profile_bio_placeholder')} maxLength={500} showCount />
      </Form.Item>
    </Form>
  );
};
