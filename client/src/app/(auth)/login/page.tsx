'use client';

import { useState, useEffect } from 'react';
import { Button, Form, Input, message, Switch, Divider } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import Image from 'next/image';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

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
    const [isSignUp, setIsSignUp] = useState(false);
    const [showForgotPassword, setShowForgotPassword] = useState(false);
    const [ssoLoading, setSsoLoading] = useState(false);
    const { login, signup, actionLoading: loading } = useAuth();
    const router = useRouter();

    // Handle Keycloak callback: ?code= present in URL (EE only)
    useEffect(() => {
        if (!IS_EE) return;
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (!code) return;
        setSsoLoading(true);
        import('@/ee').then(async (mod) => {
            try {
                await mod.handleKeycloakCallback(code);
                message.success(t('login_success'));
                router.push('/chat');
            } catch (err: unknown) {
                message.error(err instanceof Error ? err.message : t('login_failed'));
            } finally {
                setSsoLoading(false);
            }
        });
    }, []);

    const onFinish = async (values: FormValues) => {
        try {
            if (isSignUp) {
                // Signup flow
                if (!values.username) {
                    message.error(t('username_signup_required'));
                    return;
                }
                if (values.password !== values.confirmPassword) {
                    message.error(t('passwords_no_match'));
                    return;
                }
                const signupResult = await signup(values.identifier, values.username, values.password);
                
                // Handle signup result based on verification status
                if (signupResult?.is_verified) {
                    // User is verified - auto-login and redirect to chat
                    message.success(t('account_created'));
                    // await verifyAuth();
                    router.push('/chat');
                } else {
                    // User needs email verification - redirect to login with message
                    message.success(signupResult?.message || t('account_created_verify'));
                    // Switch to login mode and clear form
                    setIsSignUp(false);
                    // Don't redirect - stay on login page for user to sign in after verification
                }
            } else {
                // Login flow
                try {
                    await login(values.identifier, values.password);
                    // Only show success if login actually succeeded (no exception thrown)
                    message.success(t('login_success'));
                    // Small delay to ensure state is updated
                    await new Promise(resolve => setTimeout(resolve, 100));
                    router.push('/chat');
                } catch (error) {
                    // Error is already handled in login() function and setLoginError
                    // Don't show success message if login failed
                    // The error message will be shown by the login function
                    throw error; // Re-throw to be caught by outer catch
                }
            }
        } catch (error) {
            console.error('Authentication error:', error);
            const errorMessage = error instanceof Error ? error.message : t('login_failed');
            
            if (isSignUp) {
                message.error(`Signup failed: ${errorMessage}`);
            } else {
                // Provide more specific error messages based on the error
                if (errorMessage.includes('Invalid credentials') || errorMessage.includes('401')) {
                    message.error(t('invalid_credentials'));
                } else if (errorMessage.includes('Network error') || errorMessage.includes('fetch')) {
                    message.error(t('network_error'));
                } else if (errorMessage.includes('verify')) {
                    message.error(t('verify_email_first'));
                } else {
                    message.error(`${t('login_failed')}: ${errorMessage}`);
                }
            }
        } finally {
        }
    };

    const handleForgotPassword = async (email: string) => {
        try {
            // TODO: Implement forgot password API call
            message.success(t('reset_email_sent'));
            setShowForgotPassword(false);
        } catch (error) {
            message.error(t('reset_send_failed'));
        }
    };

    return (
        <>
            <style jsx>{`
                .login-page {
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                    background: var(--layout-background, #f8fafc);
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                }
                
                .login-form-section {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 2rem;
                    background: var(--ant-color-bg-container, #ffffff);
                }
                
                .login-branding-section {
                    flex: 1;
                    display: flex;
                    background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
                    color: white;
                    padding: 2rem;
                    align-items: center;
                    justify-content: center;
                }
                
                .form-container {
                    width: 100%;
                    max-width: 400px;
                }
                
                .logo-section {
                    text-align: center;
                    margin-bottom: 2rem;
                }
                
                .logo-section img {
                    width: 48px;
                    height: 48px;
                    margin-bottom: 1rem;
                }
                
                .logo-section h1 {
                    font-size: 1.875rem; /* 30px - standardized large heading */
                    font-weight: 700;
                    color: var(--color-text-primary, #1f2937);
                    margin: 0;
                    line-height: 1.2;
                }
                
                .form-title {
                    font-size: 1.5rem; /* 24px - standardized medium heading */
                    font-weight: 600;
                    color: var(--color-text-primary, #111827);
                    margin-bottom: 0.5rem;
                    text-align: center;
                    line-height: 1.3;
                }
                
                .form-subtitle {
                    font-size: 1rem; /* 16px - standardized body text */
                    color: var(--color-text-secondary, #6b7280);
                    margin-bottom: 2.5rem; /* Increased spacing */
                    text-align: center;
                    line-height: 1.5;
                }
                
                .form-card {
                    background: var(--ant-color-bg-container, #ffffff);
                    border-radius: 12px;
                    padding: 2.5rem; /* Increased padding */
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    border: 1px solid var(--ant-color-border, #e5e7eb);
                    margin-top: 1rem; /* Add space from logo */
                }
                
                .form-input {
                    height: 52px; /* Slightly increased height */
                    border-radius: 8px;
                    border: 1px solid var(--color-border-primary, #d1d5db);
                    font-size: 1rem; /* 16px - standardized input text */
                    padding: 0 18px; /* Increased padding */
                    transition: all 0.2s ease;
                    margin-bottom: 0.5rem; /* Add spacing between inputs */
                }
                
                .form-input:focus {
                    border-color: var(--color-brand-primary, #00c2cb);
                    box-shadow: 0 0 0 3px var(--color-brand-primary-light, rgba(37, 99, 235, 0.1));
                }
                
                .form-button {
                    height: 52px; /* Match input height */
                    border-radius: 8px;
                    font-weight: 600;
                    font-size: 1rem; /* 16px - standardized button text */
                    transition: all 0.2s ease;
                    margin-top: 1rem; /* Add spacing from inputs */
                }
                
                .form-button:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                }
                
                .toggle-section {
                    text-align: center;
                    margin-top: 2rem; /* Increased spacing */
                    padding-top: 1.5rem;
                    border-top: 1px solid #e5e7eb;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0.75rem;
                }
                
                .footer {
                    position: fixed;
                    bottom: 1rem;
                    left: 50%;
                    transform: translateX(-50%);
                    font-size: 0.875rem; /* 14px - standardized small text */
                    color: #9ca3af;
                    text-align: center;
                    line-height: 1.4;
                }
                
                .terms-privacy-text {
                    margin-top: 1rem;
                    font-size: 0.875rem; /* 14px - same as "Don't have an account?" */
                    color: #6b7280;
                    text-align: center;
                    line-height: 1.4;
                }
                
                .terms-privacy-text a {
                    color: #3b82f6;
                    text-decoration: none;
                    font-weight: 500;
                }
                
                .terms-privacy-text a:hover {
                    text-decoration: underline;
                }
                
                .branding-content {
                    text-align: center;
                    max-width: 400px;
                }
                
                .branding-title {
                    font-size: 1.875rem; /* 30px - standardized large heading */
                    font-weight: 700;
                    margin-bottom: 1rem;
                    line-height: 1.2;
                    color: #ffffff;
                }
                
                .branding-subtitle {
                    font-size: 1.125rem; /* 18px - standardized subtitle */
                    color: #cbd5e1;
                    margin-bottom: 1.5rem;
                    line-height: 1.5;
                }
                
                .branding-secondary-title {
                    font-size: 1.5rem; /* 24px - standardized secondary heading */
                    font-weight: 600;
                    margin-top: 2rem;
                    margin-bottom: 1rem;
                    line-height: 1.3;
                    color: #ffffff;
                }
                
                .branding-description {
                    font-size: 1rem; /* 16px - standardized body text */
                    color: #cbd5e1;
                    line-height: 1.5;
                }
                
                .demo-image {
                    width: 100%;
                    max-width: 360px;
                    height: auto;
                    border-radius: 12px;
                    box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.3);
                }
                
                @media (min-width: 1024px) {
                    .login-page {
                        flex-direction: row;
                    }
                    
                    .branding-title {
                        font-size: 2.25rem; /* 36px - larger for desktop */
                        margin-bottom: 1rem;
                        line-height: 1.1;
                    }
                    
                    .branding-subtitle {
                        font-size: 1.25rem; /* 20px - larger for desktop */
                        margin-bottom: 2rem;
                        line-height: 1.4;
                    }
                    
                    .branding-secondary-title {
                        font-size: 1.75rem; /* 28px - larger for desktop */
                        margin-top: 2rem;
                        margin-bottom: 1rem;
                        line-height: 1.2;
                    }
                    
                    .branding-description {
                        font-size: 1.125rem; /* 18px - larger for desktop */
                        line-height: 1.5;
                    }
                    
                    .demo-image {
                        max-width: 450px;
                    }
                    
                    .footer {
                        left: 2rem;
                        transform: none;
                        text-align: left;
                        font-size: 1rem; /* 16px - larger for desktop */
                    }
                    
                    .form-title {
                        font-size: 1.75rem; /* 28px - larger for desktop */
                        margin-bottom: 0.75rem;
                    }
                    
                    .form-subtitle {
                        font-size: 1.125rem; /* 18px - larger for desktop */
                        margin-bottom: 3rem;
                    }
                    
                    .form-input {
                        height: 56px; /* Larger for desktop */
                        font-size: 1.125rem; /* 18px - larger for desktop */
                        padding: 0 20px;
                    }
                    
                    .form-button {
                        height: 56px; /* Match input height */
                        font-size: 1.125rem; /* 18px - larger for desktop */
                    }
                }
            `}</style>
            
            <div className="login-page">
                {/* Form Section */}
                <div className="login-form-section">
                    <div className="form-container">
                        <div className="logo-section">
                        <Image
                            src="/aiser-logo.png"
                            alt={t('logo_alt')}
                            width={48}
                            height={48}
                            priority
                        />
                            <h1>Aicser</h1>
                        </div>
                        
                        <div className="form-card">
                            <h1 className="form-title">
                                {isSignUp ? t('create_account') : t('welcome_back')}
                            </h1>
                            <p className="form-subtitle">
                                {isSignUp 
                                    ? t('sign_up_subtitle') 
                                    : t('sign_in_subtitle')
                                }
                            </p>
                            
                            <Form
                                name="login"
                                onFinish={onFinish}
                                layout="vertical"
                                size="large"
                            >
                                <Form.Item
                                    name="identifier"
                                    rules={[
                                        { required: true, message: t('email_required') },
                                        { type: 'email', message: t('email_invalid') }
                                    ]}
                                >
                                    <Input
                                        prefix={<UserOutlined />}
                                        placeholder={t('email')}
                                        className="form-input"
                                    />
                                </Form.Item>
                                
                                {isSignUp && (
                                    <Form.Item
                                        name="username"
                                        rules={[
                                            { required: true, message: t('username_required') },
                                            { min: 3, message: t('username_min') }
                                        ]}
                                    >
                                        <Input
                                            prefix={<UserOutlined />}
                                            placeholder={t('username')}
                                            className="form-input"
                                        />
                                    </Form.Item>
                                )}
                                
                                <Form.Item
                                    name="password"
                                    rules={[
                                        { required: true, message: t('password_required') },
                                        { min: 6, message: t('password_min') }
                                    ]}
                                >
                                    <Input.Password
                                        prefix={<LockOutlined />}
                                        placeholder={t('password')}
                                        className="form-input"
                                    />
                                </Form.Item>
                                
                                {isSignUp && (
                                    <Form.Item
                                        name="confirmPassword"
                                        rules={[
                                            { required: true, message: t('confirm_password_required') },
                                            ({ getFieldValue }) => ({
                                                validator(_, value) {
                                                    if (!value || getFieldValue('password') === value) {
                                                        return Promise.resolve();
                                                    }
                                                    return Promise.reject(new Error(t('passwords_no_match')));
                                                },
                                            }),
                                        ]}
                                    >
                                        <Input.Password
                                            prefix={<LockOutlined />}
                                            placeholder={t('confirm_password')}
                                            className="form-input"
                                        />
                                    </Form.Item>
                                )}
                                
                                <Form.Item>
                                    <Button
                                        type="primary"
                                        htmlType="submit"
                                        loading={loading}
                                        className="form-button"
                                        block
                                    >
                                        {isSignUp ? t('sign_up') : t('sign_in')}
                                    </Button>
                                </Form.Item>
                            </Form>

                            {/* EE: Supabase / Keycloak SSO buttons */}
                            {IS_EE && !isSignUp && (
                                <>
                                    <Divider plain style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                                        or continue with
                                    </Divider>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        <Button
                                            block
                                            size="large"
                                            loading={ssoLoading}
                                            className="form-button"
                                            onClick={async () => {
                                                setSsoLoading(true);
                                                try {
                                                    const mod = await import('@/ee');
                                                    mod.loginWithKeycloak();
                                                } catch (err: unknown) {
                                                    message.error(err instanceof Error ? err.message : 'SSO redirect failed');
                                                    setSsoLoading(false);
                                                }
                                            }}
                                        >
                                            Sign in with SSO (Keycloak)
                                        </Button>
                                    </div>
                                </>
                            )}
                            
                            <div className="toggle-section">
                                <Switch
                                    checked={isSignUp}
                                    onChange={(checked) => setIsSignUp(checked)}
                                    checkedChildren={t('sign_in')}
                                    unCheckedChildren={t('sign_up')}
                                />
                                <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
                                    {isSignUp ? t('already_have_account') : t('no_account')}
                                </p>
                                
                                {!isSignUp && (
                                    <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                                        <a 
                                            href="#" 
                                            onClick={(e) => {
                                                e.preventDefault();
                                                setShowForgotPassword(true);
                                            }}
                                            style={{ color: '#3b82f6' }}
                                        >
                                            {t('forgot_password')}
                                        </a>
                                    </p>
                                )}
                                
                                <p className="terms-privacy-text">
                                    {t('terms_agree', { mode: isSignUp ? 'up' : 'in' })}{' '}
                                    <a href="/terms">{t('terms_of_service')}</a>
                                    {' '}{t('and')}{' '}
                                    <a href="/privacy">{t('privacy_policy')}</a>
                                </p>
                            </div>
                        </div>
                        
                        {/* Forgot Password Modal */}
                        {showForgotPassword && (
                            <div style={{
                                position: 'fixed',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 1000
                            }}>
                                <div style={{
                                    backgroundColor: 'var(--ant-color-bg-container, #ffffff)',
                                    padding: '2rem',
                                    borderRadius: '12px',
                                    maxWidth: '400px',
                                    width: '90%',
                                    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.1)',
                                    border: '1px solid var(--ant-color-border, #e5e7eb)'
                                }}>
                                    <h3 style={{ marginBottom: '1rem', textAlign: 'center' }}>{t('reset_password')}</h3>
                                    <p style={{ marginBottom: '1.5rem', color: '#6b7280', textAlign: 'center' }}>
                                        {t('reset_instructions')}
                                    </p>
                                    <Form
                                        onFinish={(values) => handleForgotPassword(values.email)}
                                        layout="vertical"
                                    >
                                        <Form.Item
                                            name="email"
                                            rules={[
                                                { required: true, message: t('email_required') },
                                                { type: 'email', message: t('email_invalid') }
                                            ]}
                                        >
                                            <Input
                                                prefix={<MailOutlined />}
                                                placeholder={t('email')}
                                                size="large"
                                            />
                                        </Form.Item>
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                            <Button onClick={() => setShowForgotPassword(false)}>
                                                {t('cancel')}
                                            </Button>
                                            <Button type="primary" htmlType="submit" loading={loading}>
                                                {t('send_instructions')}
                                            </Button>
                                        </div>
                                    </Form>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                
                {/* Branding Section */}
                <div className="login-branding-section">
                    <div className="branding-content">
                        <h1 className="branding-title">{t('welcome_title')}</h1>
                        <p className="branding-subtitle">
                            {t('welcome_subtitle')}
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
                        <h2 className="branding-secondary-title">
                            {t('transform_data')}
                        </h2>
                        <p className="branding-description">
                            {t('join_users')}
                        </p>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="footer">
                <p>&copy; {t('copyright')}</p>
        </div>
        </>
    );
}