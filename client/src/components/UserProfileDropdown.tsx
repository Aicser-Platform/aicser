'use client';

import React, { useState } from 'react';
import { Dropdown, Avatar, Badge, Button, Progress, message } from 'antd';
import {
  UserOutlined,
  LogoutOutlined,
  CrownOutlined,
  CreditCardOutlined,
  RocketOutlined,
  CustomerServiceOutlined,
  CommentOutlined,
  SunOutlined,
  MoonOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/stores/useAuthStore';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';
import { useOnboardingStore, useOnboarding } from '@/stores/useOnboardingStore';
import { useProfileStore } from '@/stores/useProfileStore';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useFeaturebaseStore } from '@/stores/useFeaturebaseStore';
import { useRouter } from 'next/navigation';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { LocaleFlagIcon } from '@/components/LocaleFlagIcon/LocaleFlagIcon';
import { getLocaleMeta, LOCALE_OPTIONS } from '@/config/locales';
import { fetchApi } from '@/utils/api';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

interface UserProfileDropdownProps {
  className?: string;
  showText?: boolean;
}

const UserProfileDropdown: React.FC<UserProfileDropdownProps> = ({ className, showText = true }) => {
  const t = useTranslations('user_profile_dropdown');
  const router = useRouter();
  const { openHelp } = useFeaturebaseStore();
  const { user, logout } = useAuthStore();
  const { planType, usage, subscription, loading: subLoading, refreshUsage } = useSubscriptionStore();
  const onboardingStore = useOnboardingStore();
  const { startOnboarding } = useOnboarding();
  const onboardingCompleted: boolean =
    onboardingStore.status?.completed ??
    (onboardingStore as { onboardingCompleted?: boolean }).onboardingCompleted ??
    true;
  const { profile, fetchProfile } = useProfileStore();
  const [pricingModalVisible, setPricingModalVisible] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const { isDarkMode, setIsDarkMode } = useThemeMode();
  const currentLocale = useLocale();

  const handleThemeChange = (dark: boolean) => {
    setIsDarkMode(dark);
    fetchApi('users/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: dark ? 'dark' : 'light' }),
    }).catch(() => {});
  };

  const handleLocaleChange = async (locale: string) => {
    if (locale === currentLocale) return;
    try {
      await fetchApi('users/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: locale }),
      });
      window.dispatchEvent(new CustomEvent('aicser-locale-change', { detail: locale }));
      message.success(t('language_switched', { language: getLocaleMeta(locale).label }));
    } catch {
      message.error(t('language_switch_failed'));
    }
  };

  // Fetch profile and subscription/usage on mount
  React.useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const { init: initSubscription } = useSubscriptionStore();
  React.useEffect(() => {
    if (isEnterpriseEdition) {
      void initSubscription();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive display name: prefer first+last name from profile, fallback to email prefix
  const displayName = profile?.first_name
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ')
    : (user?.email?.split('@')[0] || t('user'));

  // Prefer user-scoped metrics when available, fallback to org-level metrics.
  const aiCredits = usage.ai_credits_user ?? usage.ai_credits;
  const aiCreditsUsed = aiCredits?.used ?? 0;
  const aiCreditsLimit = aiCredits?.unlimited ? Infinity : (aiCredits?.limit ?? 30);

  // Per-user footprint (fallback to org-level for plans that don't return user-scoped usage)
  const dataSources = usage.my_data_sources_count ?? usage.data_sources_count;
  const dataSourcesUsed = dataSources?.used ?? 0;
  const dataSourcesLimit = dataSources?.unlimited ? Infinity : (dataSources?.limit ?? 2);

  const projects = usage.my_projects_count ?? usage.projects_count;
  const projectsUsed = projects?.used ?? 0;
  const projectsLimit = projects?.unlimited ? Infinity : (projects?.limit ?? 1);

  const handleDropdownVisibleChange = (open: boolean) => {
    if (open && isEnterpriseEdition) {
      void refreshUsage({ silent: true });
    }
  };

  const isTrial = subscription?.is_trial === true;
  const trialDaysRemaining = (subscription?.trial_days_remaining as number | null) ?? null;

  const getPlanBadgeColor = (plan: string) => {
    if (isTrial) return 'orange';
    switch (plan) {
      case 'free': return 'default';
      case 'pro': return 'blue';
      case 'team': return 'purple';
      case 'enterprise': return 'gold';
      default: return 'default';
    }
  };

  const getPlanDisplayName = (plan: string) => {
    const base = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Unknown';
    return isTrial ? `${base} Trial` : base;
  };

  const handleUpgrade = async (planType: string, isYearly: boolean) => {
    setUpgradeLoading(true);
    try {
      // This modal only renders in EE (gated by isEnterpriseEdition below), so the real
      // billing service is always present at this path. Previously this just closed the
      // modal and did nothing — a second, silently-broken "Upgrade" button sitting next
      // to the real one in Settings → Billing (see BillingSubscriptionTab.tsx).
      const { billingService } = await import('@/ee/services/billingService');
      const checkoutUrl = await billingService.createCheckout(planType, isYearly ? 'yearly' : 'monthly');
      window.location.href = checkoutUrl;
    } catch {
      message.error(t('failed_upgrade_plan'));
      setUpgradeLoading(false);
    }
  };

  const creditsPercentage = aiCreditsLimit === Infinity ? 0 : (aiCreditsUsed / aiCreditsLimit) * 100;
  const dataSourcesPercentage =
    dataSourcesLimit === Infinity || dataSourcesLimit === 0
      ? 0
      : (dataSourcesUsed / dataSourcesLimit) * 100;
  const projectsPercentage =
    projectsLimit === Infinity || projectsLimit === 0
      ? 0
      : (projectsUsed / projectsLimit) * 100;
  const useTeamStyleUsage = planType === 'team' || planType === 'pro';
  const showPerUserLabel = planType === 'team';

  const menuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: (
        <div style={{ padding: '8px 0' }}>
          <Link href="/settings?tab=profile">
            <div className="font-medium text-gray-900 dark:text-gray-100" style={{ marginBottom: '4px' }}>
            {displayName}
            </div>
          </Link>
          {/* <div className="text-xs text-gray-500 dark:text-gray-400">
            {organizationData.name || 'My Organization'}
          </div> */}
        </div>
      ),
    },
    ...(isEnterpriseEdition && onboardingCompleted === false
      ? [
          { type: 'divider' as const },
          {
            key: 'complete-onboarding',
            icon: <RocketOutlined />,
            label: t('complete_onboarding'),
            onClick: () => startOnboarding(),
          },
        ]
      : []),
    ...(isEnterpriseEdition
      ? [
          {
            type: 'divider' as const,
          },
          {
            key: 'plan-info',
            label: (
              <div style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isTrial ? '4px' : '10px' }}>
                  <span className="text-sm text-gray-900 dark:text-gray-100" style={{ fontWeight: 500 }}>
                    {t('current_plan')}
                  </span>
                  <Badge
                    color={getPlanBadgeColor(planType)}
                    text={subLoading ? t('loading') : getPlanDisplayName(planType)}
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                  />
                </div>
                {isTrial && trialDaysRemaining !== null && (
                  <div style={{ marginBottom: '10px' }}>
                    <span className="text-xs" style={{ color: '#fa8c16' }}>
                      {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} remaining in trial
                    </span>
                  </div>
                )}

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {showPerUserLabel ? 'AI Credits Per User' : 'AI Credits'}
                    </span>
                    <span className="text-xs text-gray-900 dark:text-gray-100" style={{ fontWeight: 600 }}>
                      {aiCreditsLimit === Infinity ? `${aiCreditsUsed} / ∞` : `${aiCreditsUsed} / ${aiCreditsLimit}`}
                    </span>
                  </div>
                  {aiCreditsLimit !== Infinity && (
                    <Progress
                      percent={creditsPercentage}
                      size="small"
                      strokeColor={creditsPercentage > 80 ? '#ff4d4f' : '#1890ff'}
                      showInfo={false}
                    />
                  )}
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {showPerUserLabel ? 'Data Sources Per User' : 'Data Sources'}
                    </span>
                    <span className="text-xs text-gray-900 dark:text-gray-100" style={{ fontWeight: 600 }}>
                      {useTeamStyleUsage
                        ? dataSourcesUsed
                        : (dataSourcesLimit === Infinity
                            ? `${dataSourcesUsed} / ∞`
                            : `${dataSourcesUsed} / ${dataSourcesLimit}`)}
                    </span>
                  </div>
                  {!useTeamStyleUsage && dataSourcesLimit !== Infinity && (
                    <Progress
                      percent={dataSourcesPercentage}
                      size="small"
                      strokeColor={dataSourcesPercentage > 80 ? '#ff4d4f' : '#52c41a'}
                      showInfo={false}
                    />
                  )}
                </div>

                <div style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {showPerUserLabel ? 'Projects Per User' : 'Projects'}
                    </span>
                    <span className="text-xs text-gray-900 dark:text-gray-100" style={{ fontWeight: 600 }}>
                      {useTeamStyleUsage
                        ? projectsUsed
                        : (projectsLimit === Infinity
                            ? `${projectsUsed} / ∞`
                            : `${projectsUsed} / ${projectsLimit}`)}
                    </span>
                  </div>
                  {!useTeamStyleUsage && projectsLimit !== Infinity && (
                    <Progress
                      percent={projectsPercentage}
                      size="small"
                      strokeColor={projectsPercentage > 80 ? '#ff4d4f' : '#722ed1'}
                      showInfo={false}
                    />
                  )}
                </div>

                <Button
                  type="primary"
                  size="small"
                  icon={<CrownOutlined />}
                  block
                  onClick={() => setPricingModalVisible(true)}
                  style={{
                    background: 'var(--color-brand-primary, #00c2cb)',
                    borderColor: 'var(--color-brand-primary, #00c2cb)',
                  }}
                >
                  {t('upgrade_plan')}
                </Button>
                <Button
                  type="link"
                  size="small"
                  block
                  icon={<CreditCardOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push('/settings?tab=billing-subscription');
                  }}
                  style={{ marginTop: 4, paddingLeft: 0 }}
                >
                  {t('manage_billing')}
                </Button>
              </div>
            ),
            onClick: () => setPricingModalVisible(true),
          },
          {
            type: 'divider' as const,
          },
        ]
      : [
          {
            type: 'divider' as const,
          },
        ]),
    {
      key: 'theme-mode',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isDarkMode ? <MoonOutlined /> : <SunOutlined />}
            <span>{t('appearance')}</span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
            {isDarkMode ? t('dark_mode') : t('light_mode')}
          </span>
        </div>
      ),
      onClick: () => handleThemeChange(!isDarkMode),
    },
    {
      key: 'language',
      label: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LocaleFlagIcon locale={currentLocale} width={16} />
            <span>{t('language')}</span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
            {getLocaleMeta(currentLocale).label}
          </span>
        </div>
      ),
      children: LOCALE_OPTIONS.map(({ value, label, nativeName, regionEn }) => ({
        key: `locale-${value}`,
        label: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <LocaleFlagIcon locale={value} width={16} title={`${nativeName} — ${regionEn}`} />
            {label}
          </span>
        ),
        onClick: () => {
          void handleLocaleChange(value);
        },
      })),
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'get-help',
      icon: <CustomerServiceOutlined />,
      label: t('get_help'),
      onClick: () => openHelp(),
    },
    ...(isEnterpriseEdition
      ? [{
          key: 'support',
          icon: <CommentOutlined />,
          label: t('support'),
          onClick: () => router.push('/support'),
        }]
      : []),
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('sign_out'),
      onClick: async () => {
        try {
          await logout();
          router.replace('/login');
        } catch (error) {
          void error;
          // Force redirect even if logout fails
          if (typeof window !== 'undefined') {
            window.location.replace('/login');
          }
        }
      },
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'about',
      label: (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
          {t('powered_by')} <b>Aicser •</b> v1.1.1
        </div>
      ),
      disabled: true,
    },
  ];

  return (
    <>
      <Dropdown
        menu={{
          items: menuItems,
          selectedKeys: [`lang-${currentLocale}`],
        }}
        trigger={['click']}
        placement="bottomRight"
        overlayClassName="user-profile-dropdown"
        overlayStyle={{ minWidth: 300, padding: '8px 0' }}
        onOpenChange={handleDropdownVisibleChange}
      >
        <div
          className={`flex items-center cursor-pointer rounded-lg transition-colors header-profile-trigger ${className ?? ''}`}
          style={showText ? { gap: 10, padding: '6px 10px' } : { padding: 0 }}
        >
          <div className="relative">
            <Avatar
              size={showText ? 'default' : 24}
              src={profile?.avatar_url || undefined}
              icon={!profile?.avatar_url ? <UserOutlined /> : undefined}
              style={!profile?.avatar_url ? { backgroundColor: 'var(--ant-color-primary)' } : undefined}
            />
          </div>
          {/* always show username on desktop and tablet, collapse only on very small screens */}
          {showText && (
            <div className="block" style={{ minWidth: 140 }}>
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100" style={{ lineHeight: '1.4' }}>
                {displayName}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400" style={{ lineHeight: '1.3' }}>
                {isEnterpriseEdition
                  ? (subLoading ? '...' : t('plan_display', { plan: getPlanDisplayName(planType) }))
                  : (user?.email || t('user'))}
              </div>
            </div>
          )}
        </div>
      </Dropdown>

      {isEnterpriseEdition && (
        <PricingModal
          visible={pricingModalVisible}
          onClose={() => setPricingModalVisible(false)}
          onUpgrade={handleUpgrade}
          currentPlan={planType}
          loading={upgradeLoading}
        />
      )}
    </>
  );
};

export default UserProfileDropdown;
