'use client';

import React, { useEffect, useState } from 'react';
import { Dropdown, Avatar, Badge, Button, Progress, message } from 'antd';
import {
  UserOutlined,
  LogoutOutlined,
  CrownOutlined,
  CreditCardOutlined,
  RocketOutlined,
  CustomerServiceOutlined,
  TeamOutlined,
  CommentOutlined,
  SunOutlined,
  MoonOutlined,
  BgColorsOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/stores/useAuthStore';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';
import { getPlanRemaining } from '@/utils/planRemaining';
import { usePermissions } from '@/hooks/usePermissions';
import { Permission } from '@/constants/permissions';
import { useOnboardingStore, useOnboarding } from '@/stores/useOnboardingStore';
import { useProfileStore } from '@/stores/useProfileStore';
import PricingModal from '@/components/PricingModal';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { COMMUNITY_URL, showCommunity } from '@/constants/community';
import { useFeaturebaseStore } from '@/stores/useFeaturebaseStore';
import { useRouter } from 'next/navigation';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { LocaleFlagIcon } from '@/components/LocaleFlagIcon/LocaleFlagIcon';
import { getLocaleMeta, LOCALE_OPTIONS } from '@/config/locales';
import { fetchApi } from '@/utils/api';
import { useWorkspaceConfig } from '@/hooks/useWorkspaceConfig';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers';
import { isSelfHostDeploymentFromEnv } from '@/utils/deploymentMode';
import { getBuildTimeAiserVersionLabel } from '@/utils/appVersion';
import { clearLocalStorageOnLogout } from '@/utils/resetWorkspaceScope';
import './UserProfileDropdown.css';

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
  const { planType, usage, subscription, loading: subLoading, refresh } = useSubscriptionStore();
  const onboardingStore = useOnboardingStore();
  const { startOnboarding } = useOnboarding();
  const onboardingCompleted: boolean =
    onboardingStore.status?.completed ??
    (onboardingStore as { onboardingCompleted?: boolean }).onboardingCompleted ??
    true;
  const { profile, fetchProfile } = useProfileStore();
  const [pricingModalVisible, setPricingModalVisible] = useState(false);
  const { isDarkMode, setIsDarkMode } = useThemeMode();
  const currentLocale = useLocale();
  const { isSelfHost } = useWorkspaceConfig({ enabled: isEnterpriseEdition });
  const showHostedBilling = isEnterpriseEdition && !isSelfHostDeploymentFromEnv() && !isSelfHost;
  const showUsageInMenu = isEnterpriseEdition;
  // Which product this is: Aicser Cloud (plans and billing), Enterprise on the customer's own servers
  // (a license, their own AI), or Community (self-hosted, own AI keys, nothing to buy).
  const deployment: 'cloud' | 'self_hosted' | 'community' = !isEnterpriseEdition ? 'community' : showHostedBilling ? 'cloud' : 'self_hosted';
  const organization = useOrganizationStore((st) => st.currentOrganization);
  const [menuOpen, setMenuOpen] = useState(false);
  const { members } = useOrganizationMembers(organization?.id ? String(organization.id) : null, menuOpen && isEnterpriseEdition);
  const myId = String(user?.user_id ?? user?.id ?? '');
  const me = members.find((m) => String(m.user_id) === myId);
  const myRole = me?.roles?.[0]?.display_name || me?.roles?.[0]?.name || null;
  const [license, setLicense] = useState<{ customer_id?: string | null; max_users?: number | null; expires_at?: string | null; is_valid?: boolean } | null>(null);
  useEffect(() => {
    if (!menuOpen || deployment !== 'self_hosted' || license) return;
    fetchApi('/api/licensing/status').then(setLicense).catch(() => setLicense(null));
  }, [menuOpen, deployment, license]);
  const [appVersionLabel, setAppVersionLabel] = useState(getBuildTimeAiserVersionLabel);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/meta/version', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { label?: string } | null) => {
        const label = data?.label?.trim();
        if (!cancelled && label) setAppVersionLabel(label);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

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
    if (showUsageInMenu) {
      void initSubscription();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUsageInMenu]);

  // Derive display name: prefer first+last name from profile, fallback to email prefix
  const displayName = profile?.first_name
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ')
    : (user?.email?.split('@')[0] || t('user'));

  // Per-user footprint (fallback to org-level for plans that don't return user-scoped usage)
  const dataSources = usage.my_data_sources_count ?? usage.data_sources_count;
  const dataSourcesUsed = dataSources?.used ?? 0;
  const dataSourcesLimit = dataSources?.unlimited ? Infinity : (dataSources?.limit ?? 2);

  const projects = usage.my_projects_count ?? usage.projects_count;
  const projectsUsed = projects?.used ?? 0;
  const projectsLimit = projects?.unlimited ? Infinity : (projects?.limit ?? 1);

  const handleDropdownVisibleChange = (open: boolean) => {
    setMenuOpen(open);
    if (open && showUsageInMenu) {
      void refresh();
    }
  };

  const isTrial = subscription?.is_trial === true;
  // Days left until the plan (or trial) ends; same rule and wording as Settings > Billing.
  const tBilling = useTranslations('billing_tab');
  // Upgrading is the owner's (org:manage_billing); admins can open billing read-only.
  const { hasPermission, hasAnyPermission } = usePermissions();
  const canManageBilling = hasPermission(Permission.ORG_MANAGE_BILLING);
  const canViewBilling = hasAnyPermission([Permission.ORG_VIEW_BILLING, Permission.ORG_MANAGE_BILLING]);
  const [nowMs] = useState(() => Date.now());
  const remaining = getPlanRemaining(subscription as Parameters<typeof getPlanRemaining>[0], nowMs);
  const remainingDate = remaining ? remaining.end.toLocaleDateString(currentLocale) : '';
  // A plan about to end (not renew) gets the warning colour in its last week.
  const remainingUrgent = Boolean(remaining && remaining.kind !== 'renews' && remaining.daysLeft <= 7);

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
  const profileSubtitle = showHostedBilling
    ? (subLoading ? '...' : t('plan_display', { plan: getPlanDisplayName(planType) }))
    : (user?.email || t('user'));

  // PricingModal runs the trial / card / KHQR checkout itself and calls onUpgrade only to
  // notify. Starting a Stripe checkout here too sent "Start Free Trial" clicks to Stripe and
  // raced the KHQR redirect.
  const handleUpgrade = () => {
    setPricingModalVisible(false);
    void refresh();
  };


  // Team plans share one monthly AI pool; Free and Pro have their own.
  const teamPlan = planType === 'team' || planType === 'enterprise';
  const pool = (teamPlan ? usage.ai_credits_team_total : undefined) ?? usage.ai_credits;
  const poolUsed = Number(pool?.used ?? 0);
  const poolLimit = pool?.unlimited ? Infinity : Number(pool?.limit ?? 0);
  const ownAiKeys = deployment !== 'cloud' || (!pool?.unlimited && poolLimit === 0);
  const seatLimit = Number((subscription as { plan?: { limits?: { max_users?: number } } } | null)?.plan?.limits?.max_users ?? 0);
  const limited = (m?: { unlimited?: boolean; limit?: number }) => Boolean(m && !m.unlimited && (m.limit ?? -1) > 0);

  const statusLine = (() => {
    if (subLoading || !remaining) return null;
    if (remaining.kind === 'trial') return { text: t('status_trial', { days: remaining.daysLeft }), urgent: remaining.daysLeft <= 3 };
    if (remaining.kind === 'renews') return { text: t('status_renews', { date: remainingDate }), urgent: false };
    // Not renewing: a date is enough until the last month, then the countdown matters.
    return remaining.daysLeft <= 30
      ? { text: t('status_ends_in', { days: remaining.daysLeft, date: remainingDate }), urgent: remainingUrgent }
      : { text: t('status_active_until', { date: remainingDate }), urgent: false };
  })();

  const meter = (label: string, used: number, limit: number, sub?: string | null) => (
    <div className="profile-menu-meter">
      <div className="profile-menu-row">
        <span>{label}</span>
        <b>{limit === Infinity ? used.toLocaleString(currentLocale) : t('used_of', { used: used.toLocaleString(currentLocale), limit: limit.toLocaleString(currentLocale) })}</b>
      </div>
      {limit !== Infinity && limit > 0 ? (
        <Progress percent={Math.min(100, (used / limit) * 100)} size="small" showInfo={false}
          status={used / limit >= 0.9 ? 'exception' : 'normal'} />
      ) : null}
      {sub ? <div className="profile-menu-sub">{sub}</div> : null}
    </div>
  );

  const planBlock = deployment === 'cloud' ? (
    <div className="profile-menu-plan">
      <div className="profile-menu-row">
        <Badge color={getPlanBadgeColor(planType)} text={<b>{subLoading ? t('loading') : getPlanDisplayName(planType)}</b>} />
        {statusLine ? <span className={statusLine.urgent ? 'profile-menu-urgent' : 'profile-menu-sub'}>{statusLine.text}</span> : null}
      </div>
      {ownAiKeys ? (
        <div className="profile-menu-row"><span>{t('ai')}</span><b>{t('ai_own_keys')}</b></div>
      ) : meter(teamPlan ? t('team_ai_credits') : t('ai_credits_month'), poolUsed, poolLimit,
        teamPlan && usage.ai_credits_user ? t('you_used', { n: Number(usage.ai_credits_user.used ?? 0).toLocaleString(currentLocale) }) : null)}
      {teamPlan && seatLimit > 0 && members.length > 0 ? meter(t('members'), members.length, seatLimit) : null}
      {!teamPlan && limited(usage.data_sources_count) ? meter(t('data_sources'), dataSourcesUsed, dataSourcesLimit) : null}
      {!teamPlan && limited(usage.projects_count) ? meter(t('projects'), projectsUsed, projectsLimit) : null}
      <div className="profile-menu-actions">
        {canManageBilling && (planType === 'free' || planType === 'pro' || isTrial) ? (
          <Button type="primary" size="small" icon={<CrownOutlined />} onClick={(e) => { e.stopPropagation(); setPricingModalVisible(true); }}>
            {planType === 'free' ? t('upgrade_plan') : t('see_plans')}
          </Button>
        ) : null}
        {planType === 'team' && canManageBilling ? (
          <Button size="small" onClick={(e) => { e.stopPropagation(); router.push('/settings?tab=team'); }}>{t('add_members')}</Button>
        ) : null}
        <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); router.push('/settings?tab=usage'); }}>{t('usage')}</Button>
        {canViewBilling ? (
          <Button type="link" size="small" icon={<CreditCardOutlined />} onClick={(e) => { e.stopPropagation(); router.push('/settings?tab=billing-subscription'); }}>
            {t('billing')}
          </Button>
        ) : null}
      </div>
    </div>
  ) : (
    <div className="profile-menu-plan">
      <div className="profile-menu-row">
        <Badge color={deployment === 'self_hosted' ? 'gold' : 'default'}
          text={<b>{deployment === 'self_hosted' ? t('enterprise_self_hosted') : t('community_edition')}</b>} />
      </div>
      {deployment === 'self_hosted' && license ? (
        <div className="profile-menu-sub">
          {license.is_valid === false ? <span className="profile-menu-urgent">{t('license_invalid')}</span> : [
            license.customer_id ? t('licensed_to', { name: license.customer_id }) : null,
            license.max_users ? t('license_seats', { n: license.max_users }) : null,
            license.expires_at ? t('license_until', { date: new Date(license.expires_at).toLocaleDateString(currentLocale) }) : null,
          ].filter(Boolean).join(' · ')}
        </div>
      ) : null}
      <div className="profile-menu-row"><span>{t('ai')}</span><b>{deployment === 'self_hosted' ? t('ai_org_models') : t('ai_own_keys')}</b></div>
      {deployment === 'self_hosted' && canViewBilling ? (
        <div className="profile-menu-actions">
          <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); router.push('/settings?tab=license'); }}>{t('license')}</Button>
          <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); router.push('/settings?tab=usage'); }}>{t('usage')}</Button>
        </div>
      ) : null}
    </div>
  );

  const menuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: (
        <Link href="/settings?tab=profile" className="profile-menu-who">
          <b>{displayName}</b>
          {user?.email ? <span>{user.email}</span> : null}
          {organization?.name ? <span>{[organization.name, myRole].filter(Boolean).join(' · ')}</span> : null}
        </Link>
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
    { type: 'divider' as const },
    { key: 'plan-info', label: planBlock, className: 'profile-menu-plan-item' },
    { type: 'divider' as const },
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
    ...(isEnterpriseEdition
      ? [{
          key: 'customize-theme',
          icon: <BgColorsOutlined />,
          label: t('customize_theme'),
          onClick: () => window.dispatchEvent(new CustomEvent('open-theme-customizer')),
        }]
      : []),
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
    ...(showCommunity
      ? [{
          key: 'community',
          icon: <TeamOutlined />,
          label: t('join_community'),
          onClick: () => window.open(COMMUNITY_URL, '_blank', 'noopener,noreferrer'),
        }]
      : []),
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
          clearLocalStorageOnLogout();
          router.replace('/login');
        } catch (error) {
          void error;
          clearLocalStorageOnLogout();
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
          {t('powered_by')} <b>Aicser •</b> {appVersionLabel}
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
        classNames={{ root: 'user-profile-dropdown' }}
        styles={{ root: { minWidth: 300, padding: '8px 0' } }}
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
              icon={!displayName ? <UserOutlined /> : undefined}
              style={!profile?.avatar_url ? { backgroundColor: 'var(--ant-color-primary)' } : undefined}
            >
              {displayName?.trim()?.charAt(0)?.toUpperCase()}
            </Avatar>
          </div>
          {/* always show username on desktop and tablet, collapse only on very small screens */}
          {showText && (
            <div className="block" style={{ minWidth: 140 }}>
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100" style={{ lineHeight: '1.4' }}>
                {displayName}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400" style={{ lineHeight: '1.3' }}>
                {isEnterpriseEdition ? profileSubtitle : (user?.email || t('user'))}
              </div>
            </div>
          )}
        </div>
      </Dropdown>

      {showHostedBilling && (
        <PricingModal
          visible={pricingModalVisible}
          onClose={() => setPricingModalVisible(false)}
          onUpgrade={handleUpgrade}
          currentPlan={planType}
        />
      )}
    </>
  );
};

export default UserProfileDropdown;
