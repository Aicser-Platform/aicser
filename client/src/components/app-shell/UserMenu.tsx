'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  CreditCard,
  Crown,
  Headset,
  LogOut,
  MessageSquareText,
  Moon,
  Palette,
  Rocket,
  Sun,
  User,
  Users,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/aicser-ui/avatar';
import { Badge } from '@/components/aicser-ui/badge';
import { Button } from '@/components/aicser-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/aicser-ui/dropdown-menu';
import { Progress } from '@/components/aicser-ui/progress';
import PricingModal from '@/components/PricingModal';
import { LocaleFlagIcon } from '@/components/LocaleFlagIcon/LocaleFlagIcon';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { getLocaleMeta, LOCALE_OPTIONS } from '@/config/locales';
import { COMMUNITY_URL, showCommunity } from '@/constants/community';
import { Permission } from '@/constants/permissions';
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers';
import { usePermissions } from '@/hooks/usePermissions';
import { useWorkspaceConfig } from '@/hooks/useWorkspaceConfig';
import { useAuthStore } from '@/stores/useAuthStore';
import { useFeaturebaseStore } from '@/stores/useFeaturebaseStore';
import { useOnboarding, useOnboardingStore } from '@/stores/useOnboardingStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProfileStore } from '@/stores/useProfileStore';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';
import { fetchApi } from '@/utils/api';
import { getBuildTimeAiserVersionLabel } from '@/utils/appVersion';
import { isSelfHostDeploymentFromEnv } from '@/utils/deploymentMode';
import { getPlanRemaining } from '@/utils/planRemaining';
import { clearLocalStorageOnLogout } from '@/utils/resetWorkspaceScope';
import { isEnterpriseEdition } from './useNavItems';

type License = {
  customer_id?: string | null;
  max_users?: number | null;
  expires_at?: string | null;
  is_valid?: boolean;
};
type Meter = { used?: number; limit?: number; unlimited?: boolean } | undefined;

const PLAN_BADGE: Record<string, string> = {
  pro: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  team: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  enterprise: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
};

function UsageMeter({ label, used, limit, sub }: { label: string; used: number; limit: number; sub?: string | null }) {
  const t = useTranslations('user_profile_dropdown');
  const locale = useLocale();
  const n = (value: number) => value.toLocaleString(locale);
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {limit === Infinity ? n(used) : t('used_of', { used: n(used), limit: n(limit) })}
        </span>
      </div>
      {limit !== Infinity && limit > 0 ? (
        <Progress value={(used / limit) * 100} tone={used / limit >= 0.9 ? 'danger' : 'default'} />
      ) : null}
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

/** Header avatar menu: who you are, plan and usage, appearance, language, help, sign out. */
export function UserMenu() {
  const t = useTranslations('user_profile_dropdown');
  const router = useRouter();
  const locale = useLocale();
  const { openHelp } = useFeaturebaseStore();
  const { user, logout } = useAuthStore();
  const { planType, usage, subscription, loading: subLoading, refresh, init } = useSubscriptionStore();
  const onboardingStore = useOnboardingStore();
  const { startOnboarding } = useOnboarding();
  const onboardingCompleted: boolean =
    onboardingStore.status?.completed ??
    (onboardingStore as { onboardingCompleted?: boolean }).onboardingCompleted ??
    true;
  const { profile, fetchProfile } = useProfileStore();
  const { isDarkMode, setIsDarkMode } = useThemeMode();
  const { isSelfHost } = useWorkspaceConfig({ enabled: isEnterpriseEdition });
  const showHostedBilling = isEnterpriseEdition && !isSelfHostDeploymentFromEnv() && !isSelfHost;
  // Aicser Cloud (plans and billing), Enterprise on the customer's servers (a license), or Community.
  const deployment: 'cloud' | 'self_hosted' | 'community' = !isEnterpriseEdition
    ? 'community'
    : showHostedBilling
      ? 'cloud'
      : 'self_hosted';
  const organization = useOrganizationStore((s) => s.currentOrganization);
  const [open, setOpen] = React.useState(false);
  const [pricingOpen, setPricingOpen] = React.useState(false);
  const { members } = useOrganizationMembers(
    organization?.id ? String(organization.id) : null,
    open && isEnterpriseEdition
  );
  const myId = String(user?.user_id ?? user?.id ?? '');
  const me = members.find((m) => String(m.user_id) === myId);
  const myRole = me?.roles?.[0]?.display_name || me?.roles?.[0]?.name || null;

  const [license, setLicense] = React.useState<License | null>(null);
  React.useEffect(() => {
    if (!open || deployment !== 'self_hosted' || license) return;
    fetchApi('/api/licensing/status')
      .then(setLicense)
      .catch(() => setLicense(null));
  }, [open, deployment, license]);

  const [versionLabel, setVersionLabel] = React.useState(getBuildTimeAiserVersionLabel);
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/meta/version', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { label?: string } | null) => {
        const label = data?.label?.trim();
        if (!cancelled && label) setVersionLabel(label);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);
  React.useEffect(() => {
    if (isEnterpriseEdition) void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount, as before
  }, []);

  const setTheme = (dark: boolean) => {
    setIsDarkMode(dark);
    fetchApi('users/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: dark ? 'dark' : 'light' }),
    }).catch(() => {});
  };

  const setLanguage = async (next: string) => {
    if (next === locale) return;
    try {
      await fetchApi('users/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
      });
      window.dispatchEvent(new CustomEvent('aicser-locale-change', { detail: next }));
      toast.success(t('language_switched', { language: getLocaleMeta(next).label }));
    } catch {
      toast.error(t('language_switch_failed'));
    }
  };

  const signOut = async () => {
    try {
      await logout();
      clearLocalStorageOnLogout();
      router.replace('/login');
    } catch {
      clearLocalStorageOnLogout();
      window.location.replace('/login');
    }
  };

  const displayName = profile?.first_name
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ')
    : user?.email?.split('@')[0] || t('user');

  // Plan block: same rules and wording as Settings › Billing.
  const isTrial = subscription?.is_trial === true;
  const { hasPermission, hasAnyPermission } = usePermissions();
  const canManageBilling = hasPermission(Permission.ORG_MANAGE_BILLING);
  const canViewBilling = hasAnyPermission([Permission.ORG_VIEW_BILLING, Permission.ORG_MANAGE_BILLING]);
  const [nowMs] = React.useState(() => Date.now());
  const remaining = getPlanRemaining(subscription as Parameters<typeof getPlanRemaining>[0], nowMs);
  const remainingDate = remaining ? remaining.end.toLocaleDateString(locale) : '';
  const statusLine = (() => {
    if (subLoading || !remaining) return null;
    if (remaining.kind === 'trial')
      return { text: t('status_trial', { days: remaining.daysLeft }), urgent: remaining.daysLeft <= 3 };
    if (remaining.kind === 'renews') return { text: t('status_renews', { date: remainingDate }), urgent: false };
    return remaining.daysLeft <= 30
      ? {
          text: t('status_ends_in', { days: remaining.daysLeft, date: remainingDate }),
          urgent: remaining.daysLeft <= 7,
        }
      : { text: t('status_active_until', { date: remainingDate }), urgent: false };
  })();
  const planName = (() => {
    const base = planType ? planType.charAt(0).toUpperCase() + planType.slice(1) : 'Unknown';
    return isTrial ? `${base} Trial` : base;
  })();

  // Team plans share one monthly AI pool; Free and Pro have their own.
  const teamPlan = planType === 'team' || planType === 'enterprise';
  const pool = (teamPlan ? usage.ai_credits_team_total : undefined) ?? usage.ai_credits;
  const poolUsed = Number(pool?.used ?? 0);
  const poolLimit = pool?.unlimited ? Infinity : Number(pool?.limit ?? 0);
  const ownAiKeys = deployment !== 'cloud' || (!pool?.unlimited && poolLimit === 0);
  const seatLimit = Number(
    (subscription as { plan?: { limits?: { max_users?: number } } } | null)?.plan?.limits?.max_users ?? 0
  );
  const limited = (m: Meter) => Boolean(m && !m.unlimited && (m.limit ?? -1) > 0);
  const meterLimit = (m: Meter, fallback: number) => (m?.unlimited ? Infinity : (m?.limit ?? fallback));
  const dataSources = usage.my_data_sources_count ?? usage.data_sources_count;
  const projects = usage.my_projects_count ?? usage.projects_count;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const linkButton = 'h-6 px-1.5 text-xs text-primary-hover dark:text-primary';

  const planBlock =
    deployment === 'cloud' ? (
      <div className="grid gap-2.5 px-2 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge
            variant="secondary"
            className={isTrial ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300' : PLAN_BADGE[planType]}
          >
            {subLoading ? t('loading') : planName}
          </Badge>
          {statusLine ? (
            <span
              className={statusLine.urgent ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'}
            >
              {statusLine.text}
            </span>
          ) : null}
        </div>
        {ownAiKeys ? (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{t('ai')}</span>
            <span className="font-medium">{t('ai_own_keys')}</span>
          </div>
        ) : (
          <UsageMeter
            label={teamPlan ? t('team_ai_credits') : t('ai_credits_month')}
            used={poolUsed}
            limit={poolLimit}
            sub={
              teamPlan && usage.ai_credits_user
                ? t('you_used', { n: Number(usage.ai_credits_user.used ?? 0).toLocaleString(locale) })
                : null
            }
          />
        )}
        {teamPlan && seatLimit > 0 && members.length > 0 ? (
          <UsageMeter label={t('members')} used={members.length} limit={seatLimit} />
        ) : null}
        {!teamPlan && limited(usage.data_sources_count) ? (
          <UsageMeter label={t('data_sources')} used={dataSources?.used ?? 0} limit={meterLimit(dataSources, 2)} />
        ) : null}
        {!teamPlan && limited(usage.projects_count) ? (
          <UsageMeter label={t('projects')} used={projects?.used ?? 0} limit={meterLimit(projects, 1)} />
        ) : null}
        <div className="flex flex-wrap items-center gap-1">
          {canManageBilling && (planType === 'free' || planType === 'pro' || isTrial) ? (
            <Button
              size="xs"
              onClick={() => {
                setOpen(false);
                setPricingOpen(true);
              }}
            >
              <Crown />
              {planType === 'free' ? t('upgrade_plan') : t('see_plans')}
            </Button>
          ) : null}
          {planType === 'team' && canManageBilling ? (
            <Button size="xs" variant="outline" onClick={() => go('/settings?tab=team')}>
              {t('add_members')}
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" className={linkButton} onClick={() => go('/settings?tab=usage')}>
            {t('usage')}
          </Button>
          {canViewBilling ? (
            <Button
              size="xs"
              variant="ghost"
              className={linkButton}
              onClick={() => go('/settings?tab=billing-subscription')}
            >
              <CreditCard />
              {t('billing')}
            </Button>
          ) : null}
        </div>
      </div>
    ) : (
      <div className="grid gap-2 px-2 py-2">
        <Badge variant="secondary" className={deployment === 'self_hosted' ? PLAN_BADGE.enterprise : undefined}>
          {deployment === 'self_hosted' ? t('enterprise_self_hosted') : t('community_edition')}
        </Badge>
        {deployment === 'self_hosted' && license ? (
          <span className="text-xs text-muted-foreground">
            {license.is_valid === false ? (
              <span className="font-medium text-destructive">{t('license_invalid')}</span>
            ) : (
              [
                license.customer_id ? t('licensed_to', { name: license.customer_id }) : null,
                license.max_users ? t('license_seats', { n: license.max_users }) : null,
                license.expires_at
                  ? t('license_until', { date: new Date(license.expires_at).toLocaleDateString(locale) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            )}
          </span>
        ) : null}
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{t('ai')}</span>
          <span className="font-medium">{deployment === 'self_hosted' ? t('ai_org_models') : t('ai_own_keys')}</span>
        </div>
        {deployment === 'self_hosted' && canViewBilling ? (
          <div className="flex gap-1">
            <Button size="xs" variant="ghost" className={linkButton} onClick={() => go('/settings?tab=license')}>
              {t('license')}
            </Button>
            <Button size="xs" variant="ghost" className={linkButton} onClick={() => go('/settings?tab=usage')}>
              {t('usage')}
            </Button>
          </div>
        ) : null}
      </div>
    );

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next && isEnterpriseEdition) void refresh();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={displayName}>
            <Avatar size="sm">
              {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
              <AvatarFallback className="bg-primary text-primary-foreground">
                {displayName.trim().charAt(0).toUpperCase() || <User className="size-3" />}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1rem)]">
          <DropdownMenuItem asChild>
            <Link
              href="/settings?tab=profile"
              className="flex-col items-start gap-0 text-left text-foreground no-underline"
            >
              <span className="font-medium">{displayName}</span>
              {user?.email ? <span className="text-xs text-muted-foreground">{user.email}</span> : null}
              {organization?.name ? (
                <span className="text-xs text-muted-foreground">
                  {[organization.name, myRole].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </Link>
          </DropdownMenuItem>
          {isEnterpriseEdition && onboardingCompleted === false ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => startOnboarding()}>
                <Rocket />
                {t('complete_onboarding')}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          {planBlock}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setTheme(!isDarkMode);
            }}
          >
            {isDarkMode ? <Moon /> : <Sun />}
            <span>{t('appearance')}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {isDarkMode ? t('dark_mode') : t('light_mode')}
            </span>
          </DropdownMenuItem>
          {isEnterpriseEdition ? (
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent('open-theme-customizer'))}>
              <Palette />
              {t('customize_theme')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <LocaleFlagIcon locale={locale} width={16} />
              <span>{t('language')}</span>
              <span className="ml-auto text-xs text-muted-foreground">{getLocaleMeta(locale).label}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={locale} onValueChange={(value) => void setLanguage(value)}>
                {LOCALE_OPTIONS.map(({ value, label, nativeName, regionEn }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <LocaleFlagIcon locale={value} width={16} title={`${nativeName} — ${regionEn}`} />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openHelp()}>
            <Headset />
            {t('get_help')}
          </DropdownMenuItem>
          {showCommunity ? (
            <DropdownMenuItem onSelect={() => window.open(COMMUNITY_URL, '_blank', 'noopener,noreferrer')}>
              <Users />
              {t('join_community')}
            </DropdownMenuItem>
          ) : null}
          {isEnterpriseEdition ? (
            <DropdownMenuItem onSelect={() => router.push('/support')}>
              <MessageSquareText />
              {t('support')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut />
            {t('sign_out')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <p className="m-0 px-2 py-1 text-center text-xs text-muted-foreground">
            {t('powered_by')} <b>Aicser •</b> {versionLabel}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>

      {showHostedBilling ? (
        <PricingModal
          visible={pricingOpen}
          onClose={() => setPricingOpen(false)}
          onUpgrade={() => {
            setPricingOpen(false);
            void refresh();
          }}
          currentPlan={planType}
        />
      ) : null}
    </>
  );
}
