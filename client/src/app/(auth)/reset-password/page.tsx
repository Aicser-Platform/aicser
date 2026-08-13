'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Input, Segmented } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { updateUserPassword } from '@/auth/updatePassword';
import { MARKETING_HOME_URL, PRIVACY_URL, TERMS_URL } from '@/constants/legalUrls';
import '../login/login.css';

export const dynamic = 'force-dynamic';

type ResetMode = 'link' | 'code';

interface ResetPasswordValues {
  email?: string;
  code?: string;
  password: string;
  confirmPassword: string;
}

export default function ResetPasswordPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';
  const isSupabaseRecovery = searchParams?.get('provider') === 'supabase';
  const initialMode = useMemo<ResetMode>(() => (token ? 'link' : 'code'), [token]);
  const [mode, setMode] = useState<ResetMode>(initialMode);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseRecovery) return;
    import('@/ee').then((mod) => {
      mod.completeSupabaseRedirectSession?.().catch(() => undefined);
    });
  }, [isSupabaseRecovery]);

  const onFinish = async (values: ResetPasswordValues) => {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      if (isSupabaseRecovery) {
        await updateUserPassword(values.password);
        setMessage(t('reset_password_success'));
      } else {
        const payload =
          mode === 'link'
            ? { token, password: values.password }
            : { email: values.email, code: values.code, password: values.password };
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
        if (!res.ok) {
          throw new Error(data.detail || data.message || t('reset_password_failed'));
        }
        setMessage(data.message || t('reset_password_success'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('reset_password_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-form-section">
        <div className="login-auth-panel">
          <div className="form-card">
            <a
              href={MARKETING_HOME_URL}
              className="logo-section"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('logo_home_aria')}
            >
              <Image src="/aiser-logo.png" alt={t('logo_alt')} width={40} height={40} priority />
              <span className="logo-name">Aicser</span>
            </a>

            <h1 className="login-reset-title">{t('reset_password')}</h1>
            <p className="form-subtitle">{t('reset_password_subtitle')}</p>

            {token && !isSupabaseRecovery ? (
              <Segmented
                block
                size="middle"
                className="auth-mode-tabs"
                value={mode}
                onChange={(value) => setMode(value as ResetMode)}
                options={[
                  { label: t('reset_with_link'), value: 'link' },
                  { label: t('reset_with_code'), value: 'code' },
                ]}
              />
            ) : null}

            {message ? (
              <Alert
                type="success"
                showIcon
                message={message}
                className="login-error-alert"
                action={
                  <Button size="small" type="link" onClick={() => router.push('/login')}>
                    {t('go_to_login')}
                  </Button>
                }
              />
            ) : null}
            {error ? <Alert type="error" showIcon message={error} className="login-error-alert" /> : null}

            <Form name="reset-password" onFinish={onFinish} layout="vertical" size="large" requiredMark>
              {mode === 'code' && !isSupabaseRecovery ? (
                <>
                  <Form.Item
                    name="email"
                    label={t('email')}
                    required
                    rules={[
                      { required: true, message: t('email_required') },
                      { type: 'email', message: t('email_invalid') },
                    ]}
                  >
                    <Input
                      placeholder={t('email_placeholder')}
                      autoComplete="email"
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                  </Form.Item>

                  <Form.Item
                    name="code"
                    label={t('recovery_code')}
                    required
                    rules={[{ required: true, message: t('recovery_code_required') }]}
                  >
                    <Input placeholder={t('recovery_code_placeholder')} autoComplete="one-time-code" />
                  </Form.Item>
                </>
              ) : null}

              <Form.Item
                name="password"
                required
                label={t('new_password')}
                rules={[
                  { required: true, message: t('new_password_required') },
                  { min: 8, message: t('new_password_min') },
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder={t('new_password')} autoComplete="new-password" />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                label={t('confirm_password')}
                required
                dependencies={['password']}
                rules={[
                  { required: true, message: t('confirm_password_required') },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) return Promise.resolve();
                      return Promise.reject(new Error(t('passwords_no_match')));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder={t('confirm_password')}
                  autoComplete="new-password"
                />
              </Form.Item>

              <Form.Item className="login-submit-item">
                <Button type="primary" htmlType="submit" loading={loading} block size="large" disabled={!!message}>
                  {t('reset_password_action')}
                </Button>
              </Form.Item>
            </Form>

            <p className="terms-privacy-text">
              <Link href="/login">{t('sign_in_link')}</Link>
              <span> | </span>
              <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">
                {t('terms_of_service')}
              </a>
              <span> | </span>
              <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                {t('privacy_policy')}
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className="login-branding-section">
        <div className="branding-content">
          <p className="branding-title">{t('welcome_title')}</p>
          <p className="branding-subtitle">{t('welcome_subtitle')}</p>
          <p className="branding-subtitle">
            <Link href="/discover">{t('explore_discover')}</Link>
          </p>
          <Image
            src="/Aiser Demo Gif.gif"
            alt={t('demo_alt')}
            width={360}
            height={300}
            className="demo-image"
            priority
            unoptimized
          />
        </div>
      </div>
    </div>
  );
}
