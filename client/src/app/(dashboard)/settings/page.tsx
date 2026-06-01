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
import { Typography, Tooltip } from 'antd';
import {
  UserOutlined,
  SecurityScanOutlined,
  BellOutlined,
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
} from '@ant-design/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import PricingModal from '@/components/PricingModal';
import { DashboardPageShell } from '@/components/layout/DashboardPageShell';
import './settings-page.css';

// ── Tab components ─────────────────────────────────────────────────────────────
import { ProfileTab } from './components/ProfileTab';
import { SecurityTab } from './components/SecurityTab';
import { NotificationsTab } from './components/NotificationsTab';
import { ApiKeysTab } from './components/ApiKeysTab';
import { DataSourcesTab } from './components/DataSourcesTab';
import { GeneralTab } from './components/GeneralTab';
import { ProjectTab } from './components/ProjectTab';

const OrganizationTab = nextDynamic(
  (() => import('@/ee').then((m) => ({ default: m.OrganizationSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const TeamTab = nextDynamic(
  (() => import('@/ee').then((m) => ({ default: m.TeamSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const IntegrationTab = nextDynamic(
  (() => import('@/ee').then((m) => ({ default: m.IntegrationSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const SubscriptionTab = nextDynamic(
  (() => import('@/ee').then((m) => ({ default: m.SubscriptionSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const RolesTab = nextDynamic(
  () => import('@/ee/app/(dashboard)/settings/components/RolesTab').then((m) => ({ default: m.RolesTab })),
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const AgentSkillsTab = nextDynamic(
  () => import('@/ee/app/(dashboard)/settings/components/AgentSkillsTab').then((m) => ({ default: m.AgentSkillsTab })),
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const AgentWorkflowsTab = nextDynamic(
  () => import('@/ee/app/(dashboard)/settings/components/AgentWorkflowsTab').then((m) => ({ default: m.AgentWorkflowsTab })),
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const BriefingsTab = nextDynamic(
  () => import('@/ee/app/(dashboard)/settings/components/BriefingsTab').then((m) => ({ default: m.BriefingsTab })),
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const EmbedTab = nextDynamic(
  () => import('./components/EmbedTab').then((m) => ({ default: m.EmbedTab })),
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const AuditLogTab = nextDynamic(
  () => import('./components/AuditLogTab').then((m) => ({ default: m.default })),
  { ssr: false }
) as React.ComponentType<TabComponentProps>;

/** Props passed to every tab so it can register an action button with the page header. */
export interface TabComponentProps {
  /** Tab calls this with its primary action button (or null to clear). */
  onSetAction?: (node: React.ReactNode) => void;
}

const { Text } = Typography;
const isEE = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

export const dynamic = 'force-dynamic';

// ── Navigation structure ───────────────────────────────────────────────────────

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  eeOnly?: boolean;
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
      { key: 'profile',       label: 'Profile',        icon: <UserOutlined />,           component: ProfileTab,        description: 'Name, avatar, preferences' },
      { key: 'security',      label: 'Security',        icon: <LockOutlined />,           component: SecurityTab,       description: '2FA, sessions, password' },
      { key: 'notifications', label: 'Notifications',   icon: <BellOutlined />,           component: NotificationsTab,  description: 'Email and push alerts' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { key: 'general',       label: 'General',         icon: <SettingOutlined />,        component: GeneralTab,        description: 'Language, timezone, theme' },
      { key: 'project',       label: 'Project',         icon: <ProjectOutlined />,        component: ProjectTab,        description: 'Name, description, project settings' },
      { key: 'organization',  label: 'Organization',    icon: <BankOutlined />,  eeOnly: true, component: OrganizationTab, description: 'Logo, name, branding' },
      { key: 'team',          label: 'Team',            icon: <TeamOutlined />,  eeOnly: true, component: TeamTab,          description: 'Members and invitations' },
      { key: 'roles',         label: 'Roles & Access',  icon: <SecurityScanOutlined />, eeOnly: true, component: RolesTab, description: 'Permissions and RBAC' },
      { key: 'billing-subscription', label: 'Billing',  icon: <CreditCardOutlined />, eeOnly: true, component: SubscriptionTab, description: 'Plan, usage, invoices' },
    ],
  },
  {
    label: 'Data & Integrations',
    items: [
      { key: 'data-sources',  label: 'Data Sources',    icon: <DatabaseOutlined />,       component: DataSourcesTab,    description: 'Connected databases and files' },
      { key: 'integrations',  label: 'Integrations',    icon: <LinkOutlined />,  eeOnly: true, component: IntegrationTab, description: 'Slack, Jira, Salesforce…' },
    ],
  },
  {
    label: 'Developer',
    items: [
      { key: 'api-keys',      label: 'API Keys',        icon: <KeyOutlined />,            component: ApiKeysTab,        description: 'Programmatic access tokens' },
      { key: 'embed',         label: 'Embed',           icon: <CodeOutlined />,           component: EmbedTab,          description: 'Embed charts in your apps' },
      { key: 'audit',         label: 'Audit Log',       icon: <AuditOutlined />,          component: AuditLogTab,       description: 'Activity history' },
    ],
  },
  {
    label: 'AI Agent',
    items: [
      { key: 'agent-skills',  label: 'Skills',          icon: <ThunderboltOutlined />, eeOnly: true, component: AgentSkillsTab, description: 'Custom tool integrations' },
      { key: 'agent-workflows', label: 'Workflows',     icon: <ApartmentOutlined />, eeOnly: true, component: AgentWorkflowsTab, description: 'Multi-step agent plans' },
      { key: 'briefings',     label: 'Briefings',       icon: <FileTextOutlined />,   eeOnly: true, component: BriefingsTab,   description: 'Scheduled AI reports' },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function resolveSettingsTab(
  tabParam: string | null | undefined,
  eeEnabled: boolean
): string {
  const visibleItems = ALL_ITEMS.filter((item) => !item.eeOnly || eeEnabled);
  const visibleKeys = new Set(visibleItems.map((item) => item.key));
  if (tabParam && visibleKeys.has(tabParam)) return tabParam;
  return 'profile';
}

// ── Component ──────────────────────────────────────────────────────────────────

const SettingsPage: React.FC = () => {
  const t = useTranslations('settings');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentProject } = useProjectStore();
  const { currentOrganization } = useOrganizationStore();
  const { planType, init: initSubscription } = useSubscriptionStore();
  const [pricingModalVisible, setPricingModalVisible] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pageAction, setPageAction] = useState<React.ReactNode>(null);

  const searchParamsString = searchParams?.toString() ?? '';

  const activeTab = useMemo(
    () => resolveSettingsTab(searchParams?.get('tab'), isEE),
    [searchParamsString, searchParams]
  );

  const {
    setActiveTab,
    loadSettingsByTab,
    loadApiKeys,
    loadTeamMembers,
    loadDataSources,
  } = useSettingsStore();

  // Keep store in sync for any legacy consumers
  useEffect(() => {
    setActiveTab(activeTab);
  }, [activeTab, setActiveTab]);

  // Clear the action button when switching tabs
  useEffect(() => { setPageAction(null); }, [activeTab]);

  // Load overview data and subscription on mount
  useEffect(() => {
    loadApiKeys();
    loadTeamMembers(currentOrganization?.id);
    loadDataSources(currentProject?.id as string | undefined);
    void initSubscription();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadApiKeys, loadTeamMembers, loadDataSources, currentOrganization?.id, currentProject?.id]);

  useEffect(() => {
    loadSettingsByTab(activeTab, currentOrganization?.id, { projectId: currentProject?.id as string | undefined });
  }, [activeTab, loadSettingsByTab, currentOrganization?.id, currentProject?.id]);

  const handleNav = useCallback((key: string) => {
    router.replace(`/settings?tab=${key}`, { scroll: false });
    setMobileSidebarOpen(false);
  }, [router]);

  const handleSetAction = useCallback((node: React.ReactNode) => {
    setPageAction(node);
  }, []);

  const activeItem = useMemo(() => ALL_ITEMS.find((i) => i.key === activeTab), [activeTab]);
  const ActiveComponent = (activeItem?.component ?? ProfileTab) as React.ComponentType<TabComponentProps>;

  // ── Sidebar nav ──────────────────────────────────────────────────────────────
  const SidebarNav = () => (
    <nav style={{ width: '100%' }}>
      {NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter((item) => !item.eeOnly || isEE);
        if (!visibleItems.length) return null;
        return (
          <div key={group.label} style={{ marginBottom: 18 }}>
            {/* Group label — matches main sidebar's section label style */}
            <div style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: 'var(--ant-color-text-quaternary)',
              padding: '0 8px',
              marginBottom: 2,
            }}>
              {group.label}
            </div>
            {visibleItems.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <Tooltip key={item.key} title={item.description} placement="right" mouseEnterDelay={0.7}>
                  <button
                    type="button"
                    onClick={() => handleNav(item.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: 'none',
                      background: isActive ? 'var(--ant-color-primary-bg)' : 'transparent',
                      color: isActive ? 'var(--ant-color-primary)' : 'var(--ant-color-text-secondary)',
                      fontWeight: isActive ? 600 : 400,
                      fontSize: 13,
                      cursor: 'pointer',
                      transition: 'background 0.12s ease, color 0.12s ease',
                      textAlign: 'left',
                      position: 'relative',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        /* --nav-hover from main sidebar CSS */
                        (e.currentTarget as HTMLElement).style.background = 'var(--ant-color-fill-tertiary, rgba(0,0,0,0.05))';
                        (e.currentTarget as HTMLElement).style.color = 'var(--ant-color-text)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                        (e.currentTarget as HTMLElement).style.color = 'var(--ant-color-text-secondary)';
                      }
                    }}
                  >
                                  {/* Active bar — matches main sidebar: border-radius 0 2px 2px 0, height 18px */}
                    {isActive && (
                      <span style={{
                        position: 'absolute',
                        left: 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 3,
                        height: 18,
                        borderRadius: '0 2px 2px 0',
                        background: 'var(--ant-color-primary)',
                      }} />
                    )}
                    <span style={{ fontSize: 14, flexShrink: 0, marginLeft: isActive ? 4 : 0 }}>
                      {item.icon}
                    </span>
                    <span style={{ lineHeight: 1.3 }}>{item.label}</span>
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
    <DashboardPageShell maxWidth={1280} className="settings-page">
      <div className="settings-layout">

        {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
        <aside
          className="settings-sidebar"
          style={{
            width: 210,
            flexShrink: 0,
            borderRight: '1px solid var(--ant-color-border)',
            padding: '20px 8px 20px 0',
          }}
        >
          <div style={{ padding: '0 8px', marginBottom: 16 }}>
            <Text style={{ fontWeight: 700, fontSize: 14, color: 'var(--ant-color-text)' }}>
              Settings
            </Text>
          </div>
          <SidebarNav />
        </aside>

        {/* ── Mobile header bar ──────────────────────────────────────────── */}
        <div className="settings-mobile-bar">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--ant-color-text)', fontSize: 13, fontWeight: 600,
            }}
          >
            <MenuOutlined style={{ fontSize: 15 }} />
            <span>{activeItem?.label || 'Settings'}</span>
          </button>
          {pageAction}
        </div>

        {/* ── Mobile drawer ────────────────────────────────────────────────── */}
        {mobileSidebarOpen && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setMobileSidebarOpen(false)}
          >
            <div
              style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 250, background: 'var(--ant-color-bg-container)', padding: '20px 8px', overflowY: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '0 8px' }}>
                <Text style={{ fontWeight: 700, fontSize: 14 }}>Settings</Text>
                <button type="button" onClick={() => setMobileSidebarOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ant-color-text-tertiary)', fontSize: 16 }}>
                  <CloseOutlined />
                </button>
              </div>
              <SidebarNav />
            </div>
          </div>
        )}

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main className="settings-main">
          {/*
           * Page header: Icon + Title (left) | Action button (right)
           * Description below title, ONE divider.
           * This is the standard Vercel/Linear/GitHub settings header.
           */}
          {activeItem && (
            <div style={{ marginBottom: 20 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}>
                {/* Left: icon + title + description */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 18, color: 'var(--ant-color-primary)', flexShrink: 0, marginTop: 2 }}>
                    {activeItem.icon}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ant-color-text)', lineHeight: 1.3 }}>
                      {activeItem.label}
                    </div>
                    {activeItem.description && (
                      <div style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)', marginTop: 2, lineHeight: 1.4 }}>
                        {activeItem.description}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: tab action button — registered by each tab via onSetAction */}
                {pageAction && (
                  <div style={{ flexShrink: 0 }}>
                    {pageAction}
                  </div>
                )}
              </div>

              {/* Single divider — tabs must NOT add their own */}
              <div style={{ borderBottom: '1px solid var(--ant-color-border)', marginTop: 14 }} />
            </div>
          )}

          {/* Tab content */}
          <ActiveComponent key={activeTab} onSetAction={handleSetAction} />
        </main>
      </div>

      {/* Responsive CSS */}
      <style jsx global>{`
        .settings-sidebar { display: flex !important; flex-direction: column; }
        .settings-mobile-bar {
          display: none;
          width: 100%;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--ant-color-border);
          background: var(--ant-color-bg-container);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        @media (max-width: 768px) {
          .settings-sidebar { display: none !important; }
          .settings-mobile-bar { display: flex !important; }
        }
        @media (min-width: 769px) {
          .settings-mobile-bar { display: none !important; }
        }
      `}</style>

      <PricingModal
        visible={pricingModalVisible}
        onClose={() => setPricingModalVisible(false)}
        onUpgrade={() => setPricingModalVisible(false)}
        currentPlan={planType}
        loading={false}
      />
    </DashboardPageShell>
  );
};

export default SettingsPage;
