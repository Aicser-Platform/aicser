import React from 'react';
import { Form, Input, Row, Col, Select } from 'antd';
import { UserOutlined, MailOutlined, PhoneOutlined, GlobalOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { ProfileFormValues } from '../../types';

const { TextArea } = Input;
const { Option } = Select;

interface ProfileFormProps {
  form: any;
  initialValues?: Partial<ProfileFormValues>;
  onFinish: (values: ProfileFormValues) => void;
  disabled?: boolean;
}

export const ProfileForm: React.FC<ProfileFormProps> = ({ 
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
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item
            name="first_name"
            label={t('profile_first_name')}
            rules={[{ required: true, message: t('profile_first_name_required') }]}
          >
            <Input prefix={<UserOutlined />} placeholder={t('profile_first_name')} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="last_name"
            label={t('profile_last_name')}
          >
            <Input prefix={<UserOutlined />} placeholder={t('profile_last_name')} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item
            name="email"
            label={t('profile_email')}
            rules={[
              { required: true, message: t('profile_email_required') },
              { type: 'email', message: t('profile_email_invalid') },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder={t('profile_email_placeholder')} disabled />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="username" label={t('profile_username')}>
            <Input prefix={<UserOutlined />} placeholder={t('profile_username_placeholder')} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item name="phone_number" label={t('profile_phone')}>
            <Input prefix={<PhoneOutlined />} placeholder={t('profile_phone')} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="company" label={t('profile_company')}>
            <Input placeholder={t('profile_company')} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item name="location" label={t('profile_location')}>
            <Input prefix={<GlobalOutlined />} placeholder={t('profile_location_placeholder')} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="timezone" label={t('timezone')}>
            <Select placeholder={t('select_timezone')}>
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
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item name="job_role" label={t('profile_job_role')}>
            <Input placeholder={t('profile_job_role')} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="industry" label={t('profile_industry')}>
            <Input placeholder={t('profile_industry')} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item name="company_size" label={t('profile_company_size')}>
            <Select placeholder={t('profile_select_company_size')}>
              <Option value="1-10">1-10</Option>
              <Option value="11-50">11-50</Option>
              <Option value="51-200">51-200</Option>
              <Option value="201-1000">201-1000</Option>
              <Option value="1000+">1000+</Option>
            </Select>
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="data_experience" label={t('profile_data_experience')}>
            <Select placeholder={t('profile_select_experience_level')}>
              <Option value="beginner">{t('profile_experience_beginner')}</Option>
              <Option value="intermediate">{t('profile_experience_intermediate')}</Option>
              <Option value="advanced">{t('profile_experience_advanced')}</Option>
              <Option value="expert">{t('profile_experience_expert')}</Option>
            </Select>
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item name="primary_use_case" label={t('profile_primary_use_case')}>
            <Input placeholder={t('profile_primary_use_case')} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item name="data_frequency" label={t('profile_data_frequency')}>
            <Select placeholder={t('profile_select_frequency')}>
              <Option value="daily">{t('profile_frequency_daily')}</Option>
              <Option value="weekly">{t('profile_frequency_weekly')}</Option>
              <Option value="monthly">{t('profile_frequency_monthly')}</Option>
              <Option value="occasionally">{t('profile_frequency_occasionally')}</Option>
            </Select>
          </Form.Item>
        </Col>
      </Row>

      <Form.Item name="bio" label={t('profile_bio')}>
        <TextArea
          rows={4}
          placeholder={t('profile_bio_placeholder')}
          maxLength={500}
          showCount
        />
      </Form.Item>
    </Form>
  );
};
