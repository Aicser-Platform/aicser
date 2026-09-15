'use client';

/**
 * Live password-strength bar + requirement checklist, shown while the user types
 * a new password on signup / password reset.
 *
 * Same visual language and i18n keys as the invite-accept flow's inline strength
 * meter (client/ee/src/ee/app/(auth)/invite/accept/page.tsx) — extracted here as a
 * shared, reusable component for the CE-side auth pages (login signup, reset
 * password) which had no strength feedback at all.
 */

import React, { useMemo } from 'react';
import { Progress, Space, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';

const { Text } = Typography;

export interface PasswordStrengthChecks {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
}

export function computePasswordChecks(password: string): PasswordStrengthChecks {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
  };
}

export function computePasswordScore(checks: PasswordStrengthChecks): number {
  return Object.values(checks).filter(Boolean).length;
}

const Req: React.FC<{ met: boolean; label: string }> = ({ met, label }) => (
  <Space size={6} style={{ display: 'flex', alignItems: 'center' }}>
    {met ? (
      <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 13 }} />
    ) : (
      <CloseCircleOutlined style={{ color: 'var(--ant-color-text-quaternary, #7c8590)', fontSize: 13 }} />
    )}
    <Text
      style={{
        fontSize: 12,
        color: met ? 'var(--ant-color-text, #374151)' : 'var(--ant-color-text-tertiary, #697280)',
      }}
    >
      {label}
    </Text>
  </Space>
);

export interface PasswordStrengthMeterProps {
  password: string;
}

export const PasswordStrengthMeter: React.FC<PasswordStrengthMeterProps> = ({ password }) => {
  const t = useTranslations('auth');

  const checks = useMemo(() => computePasswordChecks(password), [password]);
  const score = computePasswordScore(checks);

  const strength = useMemo(() => {
    if (!password) return { label: '', color: '#d9d9d9', percent: 0 };
    if (score <= 1) return { label: t('password_strength_weak'), color: '#ff4d4f', percent: 25 };
    if (score === 2) return { label: t('password_strength_fair'), color: '#faad14', percent: 50 };
    if (score === 3) return { label: t('password_strength_good'), color: '#1677ff', percent: 75 };
    return { label: t('password_strength_strong'), color: '#52c41a', percent: 100 };
  }, [password, score, t]);

  if (!password) return null;

  return (
    <div style={{ marginTop: -12, marginBottom: 16 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontSize: 12, color: '#8c8c8c' }}>{t('password_strength')}</Text>
        {strength.label && (
          <Text style={{ fontSize: 12, fontWeight: 600, color: strength.color }}>{strength.label}</Text>
        )}
      </Space>
      <Progress
        percent={strength.percent}
        showInfo={false}
        strokeColor={strength.color}
        trailColor="#f0f0f0"
        size="small"
        style={{ marginBottom: 10 }}
      />
      <div
        style={{
          background: 'var(--ant-color-fill-quaternary, #fafafa)',
          border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
          borderRadius: 8,
          padding: '10px 14px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px 12px',
        }}
      >
        <Req met={checks.length} label={t('password_rule_min_8')} />
        <Req met={checks.uppercase} label={t('password_rule_uppercase')} />
        <Req met={checks.number} label={t('password_rule_number')} />
        <Req met={checks.lowercase} label={t('password_rule_lowercase')} />
      </div>
    </div>
  );
};

export default PasswordStrengthMeter;
