'use client';

import { useState, useEffect, useCallback } from 'react';
import { Alert, Button, Form, Input, Modal, Divider, Segmented } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import Image from 'next/image';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getDefaultAppPath } from '@/utils/appPaths';
import { MARKETING_HOME_URL, PRIVACY_URL, TERMS_URL } from '@/constants/legalUrls';
import './login.css';

export const dynamic = 'force-dynamic';

const IS_EE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

interface FormValues {
  identifier: string;
  password: string;
  username?: string;
  confirmPassword?: string;
}

export default function LoginPage() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const initialSignUp =
    searchParams?.get('signup') === '1' ||
    searchParams?.get('mode') === 'signup' ||
    searchParams?.get('mode') === 'register';
  const [isSignUp, setIsSignUp] = useState(initialSignUp);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [signupMessage, setSignupMessage] = useState<string | null>(null);
  const { login, signup, actionLoading: loading, isAuthenticated, authLoading, loginError, clearLoginError } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    const next = searchParams?.get('next');
    const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : getDefaultAppPath();
    router.replace(dest);
  }, [authLoading, isAuthenticated, router, searchParams]);

  useEffect(() => {
    if (!IS_EE) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;
    setSsoLoading(true);
    import('@/ee').then(async (mod) => {
      try {
        await mod.handleKeycloakCallback(code);
        router.push(getDefaultAppPath());
      } catch (err: unknown) {
        clearLoginError();
        console.error(err);
      } finally {
        setSsoLoading(false);
      }
    });
  }, [clearLoginError, router]);

  // Supabase email-confirmation / magic-link redirects land back here with the
  // session already established client-side by supabase-js — exchange it for
  // an Aicser session instead of leaving the user staring at the login form.
  useEffect(() => {
    if (!IS_EE || isAuthenticated) return;
    import('@/ee').then(async (mod) => {
      const completed = await mod.completeSupabaseRedirectSession();
      if (completed) {
        useAuth.getState().init();
      }
    });
  }, [isAuthenticated]);

  const switchMode = useCallback(
    (signUp: boolean) => {
      setIsSignUp(signUp);
      clearLoginError();
      setSignupMessage(null);
      const params = new URLSearchParams(window.location.search);
      if (signUp) {
        params.set('mode', 'signup');
      } else {
        params.delete('mode');
        params.delete('signup');
      }
      const qs = params.toString();
      router.replace(qs ? `/login?${qs}` : '/login', { scroll: false });
    },
    [clearLoginError, router],
  );

  const onFinish = async (values: FormValues) => {
    clearLoginError();
    try {
      if (isSignUp) {
        if (!values.username) return;
        if (values.password !== values.confirmPassword) return;
        const signupResult = await signup(values.identifier, values.username, values.password);
        if (signupResult?.is_verified) {
          router.push(getDefaultAppPath());
        } else {
          setSignupMessage(signupResult?.message ?? 'Check your email to confirm your account.');
        }
        return;
      }

      await login(values.identifier, values.password);
      const next = searchParams?.get('next');
      const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : getDefaultAppPath();
      router.push(dest);
    } catch {
      // loginError is set in the store
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

            <Segmented
              block
              size="middle"
              className="auth-mode-tabs"
              value={isSignUp ? 'signup' : 'signin'}
              onChange={(value) => switchMode(value === 'signup')}
              options={[
                { label: t('sign_in'), value: 'signin' },
                { label: t('sign_up'), value: 'signup' },
              ]}
            />

            <p className="form-subtitle">{isSignUp ? t('sign_up_subtitle') : t('sign_in_subtitle')}</p>

            {signupMessage ? (
              <Alert
                type="success"
                showIcon
                message={signupMessage}
                description="Once confirmed, you'll be signed in automatically."
                className="login-error-alert"
                closable
                onClose={() => setSignupMessage(null)}
              />
            ) : loginError ? (
              <Alert
                type="error"
                showIcon
                message={loginError}
                className="login-error-alert"
                closable
                onClose={clearLoginError}
              />
            ) : null}

            <Form
              key={isSignUp ? 'signup' : 'signin'}
              name="auth"
              onFinish={onFinish}
              layout="vertical"
              size="large"
              requiredMark
            >
              <Form.Item
                name="identifier"
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

              {isSignUp ? (
                <Form.Item
                  name="username"
                  label={t('username')}
                  required
                  rules={[
                    { required: true, message: t('username_required') },
                    { min: 3, message: t('username_min') },
                  ]}
                >
                  <Input prefix={<UserOutlined />} placeholder={t('username')} autoComplete="username" />
                </Form.Item>
              ) : null}

              <Form.Item
                name="password"
                required
                label={t('password')}
                rules={[
                  { required: true, message: t('password_required') },
                  { min: isSignUp ? 8 : 6, message: isSignUp ? t('password_min_signup') : t('password_min') },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder={t('password')}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                />
              </Form.Item>

              {!isSignUp ? (
                <div className="login-forgot-row">
                  <button type="button" className="login-inline-link" onClick={() => setForgotOpen(true)}>
                    {t('forgot_password')}
                  </button>
                </div>
              ) : null}

              {isSignUp ? (
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
              ) : null}

              <Form.Item className="login-submit-item">
                <Button type="primary" htmlType="submit" loading={loading} block size="large">
                  {isSignUp ? t('sign_up') : t('sign_in')}
                </Button>
              </Form.Item>
            </Form>

            {IS_EE && !isSignUp ? (
              <>
                <Divider plain className="login-divider">
                  {t('or_continue_with')}
                </Divider>
                <Button
                  block
                  size="large"
                  type="default"
                  className="login-sso-btn"
                  loading={ssoLoading}
                  disabled={process.env.NEXT_PUBLIC_SSO_PROVIDER !== 'keycloak'}
                  onClick={async () => {
                    setSsoLoading(true);
                    try {
                      const mod = await import('@/ee');
                      mod.loginWithKeycloak();
                    } catch {
                      setSsoLoading(false);
                    }
                  }}
                >
                  {t('sign_in_with_org')}
                </Button>
              </>
            ) : null}

            <p className="terms-privacy-text">
              {t('terms_agree')}{' '}
              <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">
                {t('terms_of_service')}
              </a>{' '}
              {t('and')}{' '}
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
            <a href="/discover">{t('explore_discover')}</a>
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

      <Modal
        title={t('reset_password')}
        open={forgotOpen}
        onCancel={() => setForgotOpen(false)}
        footer={null}
        destroyOnHidden
        centered
        width={400}
        styles={{ content: { maxWidth: 'calc(100vw - 2rem)' } }}
      >
        <p className="login-modal-text">{t('reset_unavailable')}</p>
        <Button type="primary" block onClick={() => setForgotOpen(false)}>
          {t('cancel')}
        </Button>
      </Modal>
    </div>
  );
}
