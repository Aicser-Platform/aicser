'use client';

import React, { useState, useEffect } from 'react';
import { Card, Form, Select, Switch, Button, Row, Col, Typography, message, Spin, Flex } from 'antd';
import { GlobalOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { LocaleFlagIcon } from '@/components/LocaleFlagIcon/LocaleFlagIcon';
import {
  LOCALE_OPTIONS,
  DEFAULT_LOCALE,
  TIMEZONE_OPTIONS,
  DATE_FORMAT_OPTIONS,
  CURRENCY_OPTIONS,
} from '@/config/locales';
import { fetchApi } from '@/utils/api';

const { Text } = Typography;
const { Option } = Select;

const DEFAULTS = {
  language: DEFAULT_LOCALE,
  timezone: 'UTC',
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  currency: 'USD',
  theme: 'light',
  autoSave: true,
  notifications: true,
  emailUpdates: true,
  marketingEmails: false,
  dataSharing: false,
};

const AISER_THEME_MODE_KEY = 'aiser_theme_mode';

function persistThemeModeAndNotify(theme: string) {
  if (typeof window === 'undefined') return;
  try {
    if (theme === 'auto') window.localStorage.setItem(AISER_THEME_MODE_KEY, 'auto');
    else if (theme === 'dark') window.localStorage.setItem(AISER_THEME_MODE_KEY, 'dark');
    else window.localStorage.setItem(AISER_THEME_MODE_KEY, 'light');
    window.dispatchEvent(new Event('aiser-theme-preference'));
  } catch {
    /* ignore */
  }
}

import type { TabComponentProps } from '../page';

export const GeneralTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('settings');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);

  useEffect(() => {
    onSetAction?.(
      <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={loading}>
        {t('save')}
      </Button>
    );
  }, [loading, onSetAction]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchApi('users/settings');
        if (!cancelled && data?.settings && typeof data.settings === 'object') {
          const s = data.settings as Record<string, unknown>;
          const serverTheme = (s.theme as string) || DEFAULTS.theme;
          // Prefer explicit local theme (header toggle / last session) over stale server value
          let theme = serverTheme;
          if (typeof window !== 'undefined') {
            const ls = window.localStorage.getItem(AISER_THEME_MODE_KEY);
            if (ls === 'dark' || ls === 'light' || ls === 'auto') {
              theme = ls;
            }
          }
          form.setFieldsValue({
            language: s.language ?? DEFAULTS.language,
            timezone: s.timezone ?? DEFAULTS.timezone,
            dateFormat: s.dateFormat ?? DEFAULTS.dateFormat,
            timeFormat: s.timeFormat ?? DEFAULTS.timeFormat,
            currency: s.currency ?? DEFAULTS.currency,
            theme,
            autoSave: s.autoSave ?? DEFAULTS.autoSave,
            notifications: s.notifications ?? DEFAULTS.notifications,
            emailUpdates: s.emailUpdates ?? DEFAULTS.emailUpdates,
            marketingEmails: s.marketingEmails ?? DEFAULTS.marketingEmails,
            dataSharing: s.dataSharing ?? DEFAULTS.dataSharing,
          });
          persistThemeModeAndNotify(theme);
        }
      } catch {
        if (!cancelled) {
          form.setFieldsValue(DEFAULTS);
          persistThemeModeAndNotify(DEFAULTS.theme);
        }
      } finally {
        if (!cancelled) setLoadingSettings(false);
      }
    })();
    return () => { cancelled = true; };
  }, [form]);

  const onFinish = async (values: Record<string, unknown>) => {
    setLoading(true);
    try {
      await fetchApi('users/settings', {
        method: 'PATCH',
        body: JSON.stringify(values),
        headers: { 'Content-Type': 'application/json' },
      });
      if (values.language) {
        window.dispatchEvent(new CustomEvent('aicser-locale-change', { detail: values.language }));
      }
      persistThemeModeAndNotify((values.theme as string) || DEFAULTS.theme);
      message.success(t('saved'));
    } catch {
      message.error(t('save_failed'));
    } finally {
      setLoading(false);
    }
  };

  if (loadingSettings) {
    return (
      <Card size="small" bordered={false} style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
          <div style={{ marginTop: 8, color: 'var(--color-text-secondary)' }}>{t('loading')}</div>
        </div>
      </Card>
    );
  }

  return (
    <Form form={form} layout="vertical" onFinish={onFinish} initialValues={DEFAULTS}>
      <Card
        size="small"
        title={t('language_region')}
        className="mb-6"
        style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Form.Item name="language" label={t('language')} rules={[{ required: true }]}>
              <Select placeholder={t('select_language')} showSearch optionFilterProp="label">
                {LOCALE_OPTIONS.map(({ value, label, nativeName, regionEn }) => (
                  <Option key={value} value={value} label={label}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <LocaleFlagIcon locale={value} width={18} title={`${nativeName} — ${regionEn}`} />
                      {label}
                    </span>
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="timezone" label={t('timezone')} rules={[{ required: true }]}>
              <Select placeholder={t('select_timezone')} showSearch optionFilterProp="label">
                {TIMEZONE_OPTIONS.map(({ value, label }) => (
                  <Option key={value} value={value} label={label}>
                    {label}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="dateFormat" label={t('date_format')}>
              <Select placeholder={t('select_date_format')}>
                {DATE_FORMAT_OPTIONS.map(({ value, label }) => (
                  <Option key={value} value={value}>
                    {label}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="currency" label={t('currency')}>
              <Select placeholder={t('select_currency')}>
                {CURRENCY_OPTIONS.map(({ value, label }) => (
                  <Option key={value} value={value}>
                    {label}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>

      <p className='text-lg font-semibold'>{t('display_preferences')}</p>
        <Row gutter={[16, 0]}>
          <Col xs={24} md={12}>
            <Form.Item name="theme" label={t('theme')} tooltip={t('theme_tooltip')} style={{ marginBottom: 16 }}>
              <Select
                onChange={(value: string) => {
                  persistThemeModeAndNotify(value);
                }}
              >
                <Option value="light">{t('theme_light')}</Option>
                <Option value="dark">{t('theme_dark')}</Option>
                <Option value="auto">{t('theme_system')}</Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="autoSave" label={t('auto_save')} valuePropName="checked" style={{ marginBottom: 16 }}>
              <Switch />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item
              name="notifications"
              label={t('notifications')}
              valuePropName="checked"
              tooltip={t('notifications_tooltip')}
              style={{ marginBottom: 16 }}
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="dataSharing" label={t('data_sharing')} valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </Col>
        </Row>
      </Card>

    </Form>
  );
};

export default GeneralTab;
