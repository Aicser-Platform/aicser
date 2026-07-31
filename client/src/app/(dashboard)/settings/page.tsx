'use client';

/**
 * Settings Page — sidebar navigation + page-level action button.
 *
 * Layout pattern (Vercel / Linear / GitHub / Stripe):
 *
 *   [Icon]  Title                          [Action Button]
 *           Description
 *   ────────────────────────────────────────────────────
 *   Content (NO second divider, NO repeated header)
 *
 * Action button: tabs register theirs via onSetAction callback.
 * The page renders it inline with the title — never orphaned.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import nextDynamic from 'next/dynamic';
import { Tooltip } from 'antd';
import {
  UserOutlined,
  SecurityScanOutlined,
  KeyOutlined,
  TeamOutlined,
  DatabaseOutlined,
  BankOutlined,
  SettingOutlined,
  LinkOutlined,
  CodeOutlined,
  CreditCardOutlined,
  AuditOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  LockOutlined,
  MenuOutlined,
  CloseOutlined,
  ProjectOutlined,
  ApartmentOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { usePermissions, Permission } from '@/hooks/usePermissions';
import PricingModal from '@/components/PricingModal';
import { DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useWorkspaceConfig } from '@/hooks/useWorkspaceConfig';
import { isSelfHostDeploymentFromEnv } from '@/utils/deploymentMode';

// ── Tab components ─────────────────────────────────────────────────────────────
import { ProfileTab } from './components/ProfileTab';
import { SecurityTab } from './components/SecurityTab';
import { ApiKeysTab } from './components/ApiKeysTab';
import { DataSourcesTab } from './components/DataSourcesTab';
import { GeneralTab } from './components/GeneralTab';
import { ProjectTab } from './components/ProjectTab';

const OrganizationTab = nextDynamic(
  (() => import('@/ee').then((m) => ({ default: m.OrganizationSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const TeamTab = nextDynamic((() => import('@/ee').then((m) => ({ default: m.TeamSettingsTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const IntegrationTab = nextDynamic((() => import('@/ee').then((m) => ({ default: m.IntegrationSettingsTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const SubscriptionTab = nextDynamic(
  (() => import('@/ee').then((m) => ({ default: m.SubscriptionSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const LicenseTab = nextDynamic(
  (() => import('@/ee').then((m) => ({ default: m.LicenseSettingsTab }))) as any,
  { ssr: false },
) as React.ComponentType<TabComponentProps>;
const RolesTab = nextDynamic(
  (() => import('@/ee').then((m) => ({ default: m.RolesTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const AgentSkillsTab = nextDynamic(
  (() => import('@/ee').then((m) => ({ default: m.AgentSkillsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const AgentWorkflowsTab = nextDynamic(
  (() => import('@/ee').then((m) => ({ default: m.AgentWorkflowsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const BriefingsTab = nextDynamic(
  (() => import('@/ee').then((m) => ({ default: m.BriefingsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const EmbedTab = nextDynamic(() => import('./components/EmbedTab').then((m) => ({ default: m.EmbedTab })), {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AuditLogTab = nextDynamic(() => import('./components/AuditLogTab').then((m) => ({ default: m.default })), {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;

/** Props passed to every tab so it can register an action button with the page header. */
export interface TabComponentProps {
  /** Tab calls this with its primary action button (or null to clear). */
  onSetAction?: (node: React.ReactNode) => void;
}

const isEE = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());
const ADMIN_SETTINGS_PERMISSION = Permission.ORG_EDIT;
const TEAM_SETTINGS_PERMISSION = Permission.ORG_MANAGE_USERS;
const PROJECT_SETTINGS_PERMISSION = [Permission.PROJECT_CREATE, Permission.PROJECT_EDIT];

export const dynamic = 'force-dynamic';

// ── Navigation structure ───────────────────────────────────────────────────────

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  eeOnly?: boolean;
  requiredPermission?: Permission | Permission[];
  component: React.ComponentType<TabComponentProps>;
  description?: string;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Account',
    items: [
      {
        key: 'profile',
        label: 'Profile',
        icon: <UserOutlined />,
        component: ProfileTab,
        description: 'Name, avatar, preferences',
      },
      {
        key: 'security',
        label: 'Security',
        icon: <LockOutlined />,
        eeOnly: true,
        component: SecurityTab,
        description: '2FA, sessions, password',
      },
    ],
  },
  {
    label: 'Workspace',
    items: [
      {
        key: 'general',
        label: 'General',
        icon: <SettingOutlined />,
        component: GeneralTab,
        description: 'Language, timezone, theme',
      },
      {
        key: 'project',
        label: 'Project',
        icon: <ProjectOutlined />,
        eeOnly: true,
        requiredPermission: PROJECT_SETTINGS_PERMISSION,
        component: ProjectTab,
        description: 'Name, description, project settings',
      },
      {
        key: 'organization',
        label: 'Organization',
        icon: <BankOutlined />,
        eeOnly: true,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: OrganizationTab,
        description: 'Logo, name, branding',
      },
      {
        key: 'team',
        label: 'Team',
        icon: <TeamOutlined />,
        eeOnly: true,
        requiredPermission: TEAM_SETTINGS_PERMISSION,
        component: TeamTab,
        description: 'Members and invitations',
      },
      {
        key: 'roles',
        label: 'Roles & Access',
        icon: <SecurityScanOutlined />,
        eeOnly: true,
        requiredPermission: TEAM_SETTINGS_PERMISSION,
        component: RolesTab,
        description: 'Permissions and RBAC',
      },
      {
        key: 'billing-subscription',
        label: 'Billing',
        icon: <CreditCardOutlined />,
        eeOnly: true,
        requiredPermission: Permission.ORG_MANAGE_BILLING,
        component: SubscriptionTab,
        description: 'Plan, usage, invoices',
      },
      {
        key: 'license',
        label: 'License',
        icon: <SafetyCertificateOutlined />,
        eeOnly: true,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: LicenseTab,
        description: 'Enterprise license status',
      },
    ],
  },
  {
    label: 'Data & Integrations',
    items: [
      {
        key: 'data-sources',
        label: 'Data Sources',
        icon: <DatabaseOutlined />,
        requiredPermission: Permission.DATA_CONNECT,
        component: DataSourcesTab,
        description: 'Connected databases and files',
      },
      {
        key: 'integrations',
        label: 'Integrations',
        icon: <LinkOutlined />,
        eeOnly: true,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: IntegrationTab,
        description: 'Slack, Jira, Salesforce…',
      },
    ],
  },
  {
    label: 'Developer',
    items: [
      {
        key: 'api-keys',
        label: 'API Keys',
        icon: <KeyOutlined />,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: ApiKeysTab,
        description: 'Programmatic access tokens',
      },
      // {
      //   key: 'embed',
      //   label: 'Embed',
      //   icon: <CodeOutlined />,
      //   eeOnly: true,
      //   component: EmbedTab,
      //   description: 'Embed charts in your apps',
      // },
      // {
      //   key: 'audit',
      //   label: 'Audit Log',
      //   icon: <AuditOutlined />,
      //   eeOnly: true,
      //   component: AuditLogTab,
      //   description: 'Activity history',
      // },
    ],
  },
  // {
  //   label: 'AI Agent',
  //   items: [
  //     {
  //       key: 'agent-skills',
  //       label: 'Skills',
  //       icon: <ThunderboltOutlined />,
  //       eeOnly: true,
  //       component: AgentSkillsTab,
  //       description: 'Custom tool integrations',
  //     },
  //     {
  //       key: 'agent-workflows',
  //       label: 'Workflows',
  //       icon: <ApartmentOutlined />,
  //       eeOnly: true,
  //       component: AgentWorkflowsTab,
  //       description: 'Multi-step agent plans',
  //     },
  //     {
  //       key: 'briefings',
  //       label: 'Briefings',
  //       icon: <FileTextOutlined />,
  //       eeOnly: true,
  //       component: BriefingsTab,
  //       description: 'Scheduled AI reports',
  //     },
  //   ],
  // },
];

function hasRequiredPermission(
  item: NavItem,
  hasPermission: (permission: Permission) => boolean,
  hasAnyPermission: (permissions: Permission[]) => boolean
): boolean {
  if (!item.requiredPermission) return true;
  return Array.isArray(item.requiredPermission)
    ? hasAnyPermission(item.requiredPermission)
    : hasPermission(item.requiredPermission);
}

function resolveSettingsTab(tabParam: string | null | undefined, visibleItems: NavItem[]): string {
  const visibleKeys = new Set(visibleItems.map((item) => item.key));
  if (tabParam && visibleKeys.has(tabParam)) return tabParam;
  return 'profile';
}

// ── Component ──────────────────────────────────────────────────────────────────

const SettingsPage: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentProject } = useProjectStore();
  const { currentOrganization } = useOrganizationStore();
  const { hasPermission, hasAnyPermission } = usePermissions({
    organizationId: currentOrganization?.id,
  });
  const { isSelfHost } = useWorkspaceConfig({ enabled: isEE });
  const showHostedBilling = isEE && !isSelfHostDeploymentFromEnv() && !isSelfHost;
  const { planType, init: initSubscription } = useSubscriptionStore();
  const [pricingModalVisible, setPricingModalVisible] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pageAction, setPageAction] = useState<React.ReactNode>(null);

  const visibleNavGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            (item.key !== 'billing-subscription' || showHostedBilling) &&
            (!item.eeOnly || isEE) &&
            hasRequiredPermission(item, hasPermission, hasAnyPermission)
        ),
      })).filter((group) => group.items.length > 0),
    [hasPermission, hasAnyPermission, showHostedBilling]
  );
  const visibleItems = useMemo(() => visibleNavGroups.flatMap((group) => group.items), [visibleNavGroups]);
  const requestedTab = searchParams?.get('tab');
  const activeTab = resolveSettingsTab(requestedTab, visibleItems);

  useEffect(() => {
    if (requestedTab && requestedTab !== activeTab) {
      router.replace(`/settings?tab=${activeTab}`, { scroll: false });
    }
  }, [activeTab, requestedTab, router]);

  const [prevActiveTab, setPrevActiveTab] = useState(activeTab);
  if (prevActiveTab !== activeTab) {
    setPrevActiveTab(activeTab);
    setPageAction(null);
  }

  const { setActiveTab, loadSettingsByTab, loadApiKeys, loadTeamMembers, loadDataSources } = useSettingsStore();

  // Keep store in sync for any legacy consumers
  useEffect(() => {
    setActiveTab(activeTab);
  }, [activeTab, setActiveTab]);

  // Load overview data and subscription on mount
  useEffect(() => {
    loadApiKeys();
    loadTeamMembers(currentOrganization?.id);
    loadDataSources(currentProject?.id as string | undefined);
    if (showHostedBilling) {
      void initSubscription();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadApiKeys, loadTeamMembers, loadDataSources, currentOrganization?.id, currentProject?.id, showHostedBilling]);

  useEffect(() => {
    loadSettingsByTab(activeTab, currentOrganization?.id, { projectId: currentProject?.id as string | undefined });
  }, [activeTab, loadSettingsByTab, currentOrganization?.id, currentProject?.id]);

  const handleNav = useCallback(
    (key: string) => {
      router.replace(`/settings?tab=${key}`, { scroll: false });
      setMobileSidebarOpen(false);
    },
    [router]
  );

  const handleSetAction = useCallback((node: React.ReactNode) => {
    setPageAction(node);
  }, []);

  const activeItem = useMemo(() => visibleItems.find((i) => i.key === activeTab), [activeTab, visibleItems]);
  const ActiveComponent = (activeItem?.component ?? ProfileTab) as React.ComponentType<TabComponentProps>;

  // ── Sidebar nav ──────────────────────────────────────────────────────────────
  const SidebarNav = () => (
    <nav className="w-full">
      {visibleNavGroups.map((group) => {
        return (
          <div key={group.label} className="mb-[18px]">
            {/* Group label — matches main sidebar's section label style */}
            <div className="mb-0.5 px-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--ant-color-text-quaternary)]">
              {group.label}
            </div>
            {group.items.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <Tooltip key={item.key} title={item.description} placement="right" mouseEnterDelay={0.7}>
                  <button
                    type="button"
                    onClick={() => handleNav(item.key)}
                    className={[
                      'relative flex w-full cursor-pointer items-center gap-2 rounded-md border-0 px-2 py-1.5 text-left text-[13px]',
                      'transition-colors duration-150',
                      isActive
                        ? 'bg-[var(--ant-color-primary-bg)] font-semibold text-[var(--ant-color-primary)]'
                        : 'bg-transparent font-normal text-[var(--ant-color-text-secondary)] hover:bg-[var(--ant-color-fill-tertiary)] hover:text-[var(--ant-color-text)]',
                    ].join(' ')}
                  >
                    <span className="shrink-0 text-sm">{item.icon}</span>
                    <span className="leading-[1.3]">{item.label}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  return (
    <DashboardPageShell className="settings-page">
      <div className="flex w-full min-h-0 flex-1 flex-col items-stretch md:flex-row md:items-start">
        {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
        <aside className="sticky top-0 hidden w-[210px] shrink-0 flex-col self-start border-r border-[var(--ant-color-border)] py-5 pl-0 pr-2 md:flex">
          <div className="mb-4 px-2">
            <span className="text-sm font-bold text-[var(--ant-color-text)]">Settings</span>
          </div>
          <SidebarNav />
        </aside>

        {/* ── Mobile header bar ──────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 flex w-full items-center justify-between gap-2.5 border-b border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent text-[13px] font-semibold text-[var(--ant-color-text)]"
          >
            <MenuOutlined className="text-[15px]" />
            <span>{activeItem?.label || 'Settings'}</span>
          </button>
          {pageAction}
        </div>

        {/* ── Mobile drawer ────────────────────────────────────────────────── */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-[1000] bg-black/40 md:hidden" onClick={() => setMobileSidebarOpen(false)}>
            <div
              className="absolute inset-y-0 left-0 w-[250px] overflow-y-auto bg-[var(--ant-color-bg-container)] px-2 py-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between px-2">
                <span className="text-sm font-bold text-[var(--ant-color-text)]">Settings</span>
                <button
                  type="button"
                  aria-label="Close settings navigation"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="cursor-pointer border-0 bg-transparent text-base text-[var(--ant-color-text-tertiary)] hover:text-[var(--ant-color-text)]"
                >
                  <CloseOutlined />
                </button>
              </div>
              <SidebarNav />
            </div>
          </div>
        )}

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main className="w-full min-w-0 flex-1 overflow-visible px-4 py-4 sm:px-5 md:w-0 md:px-7 md:py-6 lg:px-8">
          {/*
           * Page header: Icon + Title (left) | Action button (right)
           * Description below title, ONE divider.
           * This is the standard Vercel/Linear/GitHub settings header.
           */}
          {activeItem && (
            <div className="mb-5">
              <div className="flex items-center justify-between gap-3">
                {/* Left: icon + title + description */}
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-0.5 shrink-0 text-lg text-[var(--ant-color-primary)]">{activeItem.icon}</span>
                  <div className="min-w-0">
                    <div className="text-base font-bold leading-[1.3] text-[var(--ant-color-text)]">
                      {activeItem.label}
                    </div>
                    {activeItem.description && (
                      <div className="mt-0.5 text-xs leading-[1.4] text-[var(--ant-color-text-tertiary)]">
                        {activeItem.description}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: tab action button — registered by each tab via onSetAction */}
                {pageAction && <div className="hidden shrink-0 md:block">{pageAction}</div>}
              </div>

              {/* Single divider — tabs must NOT add their own */}
              <div className="mt-3.5 border-b border-[var(--ant-color-border)]" />
            </div>
          )}

          {/* Tab content */}
          <ActiveComponent key={activeTab} onSetAction={handleSetAction} />
        </main>
      </div>

      {showHostedBilling && (
        <PricingModal
          visible={pricingModalVisible}
          onClose={() => setPricingModalVisible(false)}
          onUpgrade={() => setPricingModalVisible(false)}
          currentPlan={planType}
          loading={false}
        />
      )}
    </DashboardPageShell>
  );
};

export default SettingsPage;
