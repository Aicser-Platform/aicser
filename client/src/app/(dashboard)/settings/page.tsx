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
import { Input, Tabs, Tooltip } from 'antd';
import { MOVED_TABS, groupSettingsPages } from './settingsPages';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import {
  UserOutlined,
  GlobalOutlined,
  ApiOutlined,
  SearchOutlined,
  InfoCircleOutlined,
  SecurityScanOutlined,
  KeyOutlined,
  TeamOutlined,
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
  SafetyOutlined,
  LineChartOutlined,
  FileSearchOutlined,
  BellOutlined,
  DollarOutlined,
  ClusterOutlined,
  BulbOutlined,
  BranchesOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { getOrganizationBranding } from '@/utils/orgBranding';
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
import { GeneralTab } from './components/GeneralTab';
import { ProjectTab } from './components/ProjectTab';
import { NotificationsTab } from './components/NotificationsTab';
import { CommunityUsageTab } from './components/CommunityUsageTab';

const OrganizationTab = nextDynamic(
  (() => import('@/ee-lazy/OrganizationSettingsTab').then((m) => ({ default: m.OrganizationSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const TeamTab = nextDynamic((() => import('@/ee-lazy/TeamSettingsTab').then((m) => ({ default: m.TeamSettingsTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const IntegrationTab = nextDynamic((() => import('@/ee-lazy/IntegrationSettingsTab').then((m) => ({ default: m.IntegrationSettingsTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AccessOverviewTab = nextDynamic(() => import('./components/AccessOverviewTab').then((m) => m.AccessOverviewTab), {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
// Storage, compute and cost are admin settings; people browse lake tables in the Catalog.
const LakehouseSettingsTab = nextDynamic(
  (() =>
    import('@/ee-lazy/WarehousePage').then((m) => ({
      default: function LakehouseSettings() {
        const Page = m.WarehousePage;
        return <Page embedded />;
      },
    }))) as any,
  { ssr: false },
) as React.ComponentType<TabComponentProps>;
const UsageAnalyticsTab = nextDynamic(
  (() => import('@/ee-lazy/UsageAnalyticsSettingsTab').then((m) => ({ default: m.UsageAnalyticsSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const LicenseTab = nextDynamic((() => import('@/ee-lazy/LicenseSettingsTab').then((m) => ({ default: m.LicenseSettingsTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AdoptionSettingsTab = nextDynamic((() => import('@/ee-lazy/AdoptionTab').then((m) => ({ default: m.AdoptionTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const SubscriptionTab = nextDynamic(
  (() => import('@/ee-lazy/SubscriptionSettingsTab').then((m) => ({ default: m.SubscriptionSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType<TabComponentProps>;
const AgentBudgetTab = nextDynamic((() => import('@/ee-lazy/AgentBudgetTab').then((m) => ({ default: m.AgentBudgetTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const PersonalLicenseTab = nextDynamic((() => import('@/ee-lazy/PersonalLicenseTab').then((m) => ({ default: m.PersonalLicenseTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const RolesTab = nextDynamic((() => import('@/ee-lazy/RolesTab').then((m) => ({ default: m.RolesTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AgentSkillsTab = nextDynamic((() => import('@/ee-lazy/AgentSkillsTab').then((m) => ({ default: m.AgentSkillsTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const ReleasesTab = nextDynamic((() => import('@/ee-lazy/ReleasesPanel').then((m) => ({ default: m.ReleasesPanel }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AnswerStyleTab = nextDynamic((() => import('@/ee-lazy/AnswerStyleTab').then((m) => ({ default: m.AnswerStyleTab }))) as any, {
  ssr: false,
  loading: () => <SettingsTabLoading />,
}) as React.ComponentType<TabComponentProps>;
const EcosystemTab = nextDynamic((() => import('@/ee-lazy/EcosystemTab').then((m) => ({ default: m.EcosystemTab }))) as any, {
  ssr: false,
  loading: () => <SettingsTabLoading />,
}) as React.ComponentType<TabComponentProps>;
const PublishingTab = nextDynamic(() => import('./components/PublishingTab'), { ssr: false, loading: () => <SettingsTabLoading /> });
const AgentMcpTab = nextDynamic((() => import('@/ee-lazy/AgentMcpTab').then((m) => ({ default: m.AgentMcpTab }))) as any, {
  ssr: false,
  loading: () => <SettingsTabLoading />,
});
const AgentWorkflowsTab = nextDynamic((() => import('@/ee-lazy/AgentWorkflowsTab').then((m) => ({ default: m.AgentWorkflowsTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AgentCapabilitiesTab = nextDynamic((() => import('@/ee-lazy/AgentCapabilitiesTab').then((m) => ({ default: m.AgentCapabilitiesTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const PrivacyRequestsTab = nextDynamic((() => import('@/ee-lazy/PrivacyRequestsTab').then((m) => ({ default: m.PrivacyRequestsTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const DataSharesTab = nextDynamic((() => import('@/ee-lazy/DataSharesTab').then((m) => ({ default: m.DataSharesTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AgentMemoryTab = nextDynamic((() => import('@/ee-lazy/AgentMemoryTab').then((m) => ({ default: m.AgentMemoryTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AgentRulesTab = nextDynamic((() => import('@/ee-lazy/AgentRulesTab').then((m) => ({ default: m.AgentRulesTab }))) as any, {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const EmbedTab = nextDynamic(() => import('./components/EmbedTab').then((m) => ({ default: m.EmbedTab })), {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AuditLogTab = nextDynamic(() => import('./components/AuditLogTab').then((m) => ({ default: m.default })), {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AIQualityTab = nextDynamic(() => import('./components/AIQualityTab').then((m) => ({ default: m.default })), {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AIDecisionLayerTab = nextDynamic(() => import('./components/AIDecisionLayerTab').then((m) => ({ default: m.default })), {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const IdentityTab = nextDynamic(() => import('./components/IdentityTab').then((m) => ({ default: m.default })), {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const AIResidencyTab = nextDynamic(() => import('./components/AIResidencyTab').then((m) => ({ default: m.default })), {
  ssr: false,
}) as React.ComponentType<TabComponentProps>;
const FeatureGate = nextDynamic((() => import('@/ee-lazy/FeatureGate').then((m) => ({ default: m.FeatureGate }))) as any, {
  ssr: false,
}) as React.ComponentType<{ feature: string; children: React.ReactNode }>;

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
  /** Plan-feature key (usePlanRestrictions/hasFeature) this tab requires.
   * Nav item still shows (so the tab is discoverable and pitches the
   * upgrade), but its content is replaced with a contextual upgrade prompt
   * instead of the tab's real content — avoids a confusing 402 on click for
   * a plan-gated tab a lower tier could otherwise get to. */
  requiredFeature?: string;
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
        // The Activity bell's "Manage settings" and /settings/notifications land here.
        key: 'notifications',
        label: 'Notifications',
        icon: <BellOutlined />,
        component: NotificationsTab,
        description: 'Email and the Activity bell',
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
        key: 'releases',
        label: 'Releases',
        icon: <BranchesOutlined />,
        eeOnly: true,
        requiredFeature: 'govern',
        component: ReleasesTab,
        description: 'Move definitions between projects (dev to prod) with review, and keep them in Git',
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
        key: 'adoption',
        label: 'Adoption',
        icon: <LineChartOutlined />,
        eeOnly: true,
        requiredPermission: Permission.AUDIT_VIEW,
        component: AdoptionSettingsTab,
        description: 'Who uses Aicser and what goes unused',
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
        key: 'usage',
        label: 'Usage',
        icon: <LineChartOutlined />,
        // Community has no billing roles: its usage page is everyone's.
        requiredPermission: isEE ? [Permission.ORG_VIEW_BILLING, Permission.ORG_MANAGE_BILLING] : undefined,
        component: isEE ? UsageAnalyticsTab : CommunityUsageTab,
        description: 'Your footprint and AI activity',
      },
      {
        key: 'billing-subscription',
        label: 'Billing',
        icon: <CreditCardOutlined />,
        eeOnly: true,
        // Owners and admins can both change the plan and pay (org:manage_billing).
        requiredPermission: [Permission.ORG_VIEW_BILLING, Permission.ORG_MANAGE_BILLING],
        component: SubscriptionTab,
        description: 'Seats, payment and invoices',
      },
      {
        key: 'agent-budget',
        label: 'AI budget',
        icon: <CreditCardOutlined />,
        eeOnly: true,
        requiredPermission: [Permission.ORG_VIEW_BILLING, Permission.ORG_MANAGE_BILLING],
        requiredFeature: 'ai_cost_center',
        component: AgentBudgetTab,
        description: 'Spending limits for AI',
      },
      {
        key: 'identity',
        label: 'Directory sync',
        icon: <TeamOutlined />,
        eeOnly: true,
        // Same permission the SCIM token/role API checks: provisioning people is user management.
        requiredPermission: Permission.ORG_MANAGE_USERS,
        component: IdentityTab,
        description: 'Users and groups from your identity provider (SCIM)',
        requiredFeature: 'sso_saml',
      },
      {
        key: 'ai-residency',
        label: 'AI Residency',
        icon: <SafetyOutlined />,
        eeOnly: true,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: AIResidencyTab,
        description: 'Where your prompts and data may be processed',
        requiredFeature: 'ai_residency',
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
        key: 'integrations',
        label: 'Integrations',
        icon: <LinkOutlined />,
        eeOnly: true,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: IntegrationTab,
        description: 'Email delivery, Slack, Teams, lake storage, and more',
      },
      {
        key: 'ecosystem',
        label: 'Microsoft and Google',
        icon: <LinkOutlined />,
        eeOnly: true,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: EcosystemTab,
        description: 'Sign-in, AI, Copilot and Gemini, in one place',
      },
      {
        key: 'lakehouse',
        label: 'Lakehouse',
        icon: <ClusterOutlined />,
        eeOnly: true,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        requiredFeature: 'lakehouse',
        component: LakehouseSettingsTab,
        description: 'Storage, compute, query cost and retention',
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
        component: ApiKeysTab,
        description: 'Programmatic access tokens',
        requiredFeature: 'api_access',
      },
      {
        key: 'embed',
        label: 'Embed',
        icon: <CodeOutlined />,
        eeOnly: true,
        component: EmbedTab,
        description: 'Embed charts in your apps',
        requiredPermission: Permission.EMBED_CREATE,
        requiredFeature: 'embed_analytics',
      },
      {
        key: 'access-overview',
        label: 'Access overview',
        icon: <SafetyOutlined />,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: AccessOverviewTab,
        description: 'Row and column rules across every connection',
      },
      {
        key: 'publishing',
        label: 'Publishing',
        icon: <GlobalOutlined />,
        eeOnly: true,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: PublishingTab,
        description: 'Who may publish outside the organization, and for how long',
      },
      {
        key: 'privacy',
        label: 'Privacy requests',
        icon: <SafetyOutlined />,
        eeOnly: true,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: PrivacyRequestsTab,
        description: "Find one person's data in the lakehouse; erasing it also keeps them out of later pipeline runs",
      },
      {
        key: 'data-shares',
        label: 'Data shares',
        icon: <SafetyOutlined />,
        eeOnly: true,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: DataSharesTab,
        description: 'Lakehouse tables a partner reads over HTTPS with a token, filtered to the rows they may see',
      },
      {
        key: 'audit',
        label: 'Audit Log',
        icon: <AuditOutlined />,
        eeOnly: true,
        component: AuditLogTab,
        description: 'Activity history',
        requiredPermission: Permission.AUDIT_VIEW,
        requiredFeature: 'audit_logs',
      },
    ],
  },
  {
    label: 'AI Agent',
    items: [
      {
        key: 'agent-skills',
        label: 'Skills',
        icon: <ThunderboltOutlined />,
        eeOnly: true,
        component: AgentSkillsTab,
        description: 'Instruction packs the agent uses',
        requiredPermission: [Permission.AGENT_CONFIGURE, ADMIN_SETTINGS_PERMISSION],
        requiredFeature: 'agent_configuration',
      },
      {
        key: 'agent-mcp',
        label: 'Outside tools',
        icon: <ApiOutlined />,
        eeOnly: true,
        component: AgentMcpTab,
        description: 'MCP servers whose tools the agent may use, one tool at a time',
        requiredPermission: [Permission.AGENT_CONFIGURE, ADMIN_SETTINGS_PERMISSION],
        requiredFeature: 'agent_configuration',
      },
      // {
      //   key: 'agent-workflows',
      //   label: 'Workflows',
      //   icon: <ApartmentOutlined />,
      //   eeOnly: true,
      //   component: AgentWorkflowsTab,
      //   description: 'Trigger → multi-step capability pipelines',
      //   requiredPermission: [Permission.AGENT_CONFIGURE, ADMIN_SETTINGS_PERMISSION],
      //   requiredFeature: 'agent_configuration',
      // },
      {
        key: 'agent-capabilities',
        label: 'Capabilities',
        icon: <SafetyOutlined />,
        eeOnly: true,
        component: AgentCapabilitiesTab,
        description: 'Govern which agent tools are allowed',
        requiredPermission: [Permission.AGENT_CONFIGURE, ADMIN_SETTINGS_PERMISSION],
        requiredFeature: 'agent_configuration',
      },
      {
        key: 'ai-quality',
        label: 'AI Quality',
        icon: <LineChartOutlined />,
        eeOnly: true,
        component: AIQualityTab,
        description: 'Grounding, goal completion, and feedback trends',
        requiredPermission: Permission.AUDIT_VIEW,
        requiredFeature: 'audit_logs',
      },
      {
        key: 'ai-decision-layer',
        label: 'AI routing',
        icon: <ThunderboltOutlined />,
        eeOnly: true,
        component: AIDecisionLayerTab,
        description: 'Which steps the assistant decides with your own fast model, and whether each is ready',
        requiredPermission: [Permission.AGENT_CONFIGURE, ADMIN_SETTINGS_PERMISSION],
        requiredFeature: 'agent_configuration',
      },
      {
        key: 'answer-style',
        label: 'Answer style',
        icon: <SafetyOutlined />,
        eeOnly: true,
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        component: AnswerStyleTab,
        description: 'How Ask and your agents sound',
      },
      {
        key: 'personal-license',
        label: 'Aicser Personal',
        icon: <SafetyCertificateOutlined />,
        eeOnly: true,
        component: PersonalLicenseTab,
        description: 'Your own desktop license',
      },
      {
        key: 'ai-memory',
        label: 'AI memory',
        icon: <BulbOutlined />,
        eeOnly: true,
        component: AgentMemoryTab,
        description: 'What Aicser remembers for you, your project and your organization',
      },
      {
        key: 'agent-rules',
        label: 'Agent rules',
        icon: <SafetyCertificateOutlined />,
        eeOnly: true,
        component: AgentRulesTab,
        description: 'Which actions need approval, devices, retention and on-device models',
        requiredPermission: ADMIN_SETTINGS_PERMISSION,
        requiredFeature: 'agent',
      },
    ],
  },
];

/**
 * Who each page is for (QA F-SET-01): personal settings, everyday workspace setup, AI tuning,
 * admin-only governance, then developer tools. Permission filtering still hides what a role
 * can't use, so a business user sees "Me" and a short "Workspace"; admins see the rest grouped.
 */

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

function SettingsTabLoading() {
  return <AppLoadingIndicator variant="inline" />;
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
  const orgBranding = getOrganizationBranding(currentOrganization);
  const orgNavIcon = orgBranding.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- branding may be data-URI or signed URL
    <img
      src={orgBranding.logoUrl}
      alt=""
      width={16}
      height={16}
      className="rounded object-contain"
      draggable={false}
    />
  ) : null;
  const { hasPermission, hasAnyPermission, loading: permissionsLoading } = usePermissions({
    organizationId: currentOrganization?.id,
  });
  const { isSelfHost } = useWorkspaceConfig({ enabled: isEE });
  const isSelfHostMode = isSelfHostDeploymentFromEnv() || isSelfHost;
  const showHostedBilling = isEE && !isSelfHostMode;
  const { planType, subscription, init: initSubscription } = useSubscriptionStore();
  // A sandbox isn't "free" here, even though it counts as free everywhere else.
  const planSlug = (subscription as { plan?: { slug?: string } } | null)?.plan?.slug ?? planType;
  const [pricingModalVisible, setPricingModalVisible] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pageAction, setPageAction] = useState<React.ReactNode>(null);
  const [navQuery, setNavQuery] = useState('');

  // Upgrade CTAs (open-pricing-modal) are handled once by GlobalPricingModal in the dashboard layout.

  const tNav = useTranslations('settings_nav');
  const visibleItems = useMemo(() => {
    const tr = (key: string, fallback: string) => (tNav.has(key as any) ? tNav(key as any) : fallback);
    return NAV_GROUPS.flatMap((group) => group.items)
      .filter(
        (item) =>
          (item.key !== 'billing-subscription' || showHostedBilling) &&
          // A license for one person's desktop: no use to a company on Team or Enterprise.
          (item.key !== 'personal-license' || (showHostedBilling && (planSlug === 'free' || planSlug === 'pro'))) &&
          (item.key !== 'license' || isSelfHostMode) && // Cloud has a subscription, not a license
          (!item.eeOnly || isEE) &&
          hasRequiredPermission(item, hasPermission, hasAnyPermission)
      )
      .map((item) => ({
        ...item,
        label: tr(`${item.key}_label`, item.label),
        description: item.description ? tr(`${item.key}_desc`, item.description) : item.description,
      }));
  }, [hasPermission, hasAnyPermission, showHostedBilling, isSelfHostMode, planSlug, tNav]);
  // The sidebar lists pages; a page holding several settings shows them as tabs.
  const visiblePageGroups = useMemo(
    () => groupSettingsPages(visibleItems, (key, fallback) => (tNav.has(key as any) ? tNav(key as any) : fallback)),
    [visibleItems, tNav],
  );
  const requestedTab = searchParams?.get('tab');
  // While permissions load, gated tabs look invisible; resolving then sent every deep link
  // (?tab=identity, ?tab=ai-residency…) to Profile and rewrote the URL. Keep the requested
  // tab until permissions are known, and only then fall back if it really isn't allowed.
  const knownTab = Boolean(requestedTab && NAV_GROUPS.some((g) => g.items.some((i) => i.key === requestedTab)));
  const activeTab =
    permissionsLoading && knownTab ? (requestedTab as string) : resolveSettingsTab(requestedTab, visibleItems);

  useEffect(() => {
    if (requestedTab && MOVED_TABS[requestedTab]) {
      router.replace(MOVED_TABS[requestedTab]);
      return;
    }
    if (requestedTab === 'outbound-email') {
      router.replace('/settings?tab=integrations&section=outbound-email', { scroll: false });
      return;
    }
    // Metric definitions live in Semantic models now.
    if (requestedTab === 'kpi-definitions') {
      router.replace('/semantic-layer', { scroll: false });
      return;
    }
    // Connections live on one page; the old Settings copy points there.
    if (requestedTab === 'data-sources') {
      router.replace('/data', { scroll: false });
      return;
    }
    if (permissionsLoading) return;
    if (requestedTab && requestedTab !== activeTab) {
      router.replace(`/settings?tab=${activeTab}`, { scroll: false });
    }
  }, [activeTab, requestedTab, router, permissionsLoading]);

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
    loadDataSources();
    if (isEE) {
      void initSubscription();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadApiKeys, loadTeamMembers, loadDataSources, currentOrganization?.id, showHostedBilling]);

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
  const activePage = useMemo(
    () => visiblePageGroups.flatMap((g) => g.pages).find((p) => p.items.some((i) => i.key === activeTab)),
    [activeTab, visiblePageGroups],
  );
  const ActiveComponent = (
    activeItem?.component ?? (permissionsLoading ? SettingsTabLoading : ProfileTab)
  ) as React.ComponentType<TabComponentProps>;

  // Search finds a page by its name, its description or any of its tabs, and opens the tab that matched.
  const query = navQuery.trim().toLowerCase();
  const matches = (text?: string) => Boolean(text && text.toLowerCase().includes(query));
  const searchedGroups = query
    ? visiblePageGroups
        .map((group) => ({
          ...group,
          pages: group.pages.filter(
            (page) => matches(page.label) || matches(page.description) || page.items.some((i) => matches(i.label) || matches(i.description)),
          ),
        }))
        .filter((group) => group.pages.length > 0)
    : visiblePageGroups;
  const firstMatchKey = (page: (typeof visiblePageGroups)[number]['pages'][number]) =>
    (query ? page.items.find((i) => matches(i.label)) ?? page.items.find((i) => matches(i.description)) : undefined)?.key ??
    page.items[0].key;

  const navSearch = (
    <Input
      size="small"
      allowClear
      prefix={<SearchOutlined className="text-[var(--ant-color-text-tertiary)]" />}
      placeholder={tNav('search_placeholder')}
      aria-label={tNav('search_placeholder')}
      value={navQuery}
      onChange={(e) => setNavQuery(e.target.value)}
      onPressEnter={() => {
        const first = searchedGroups[0]?.pages[0];
        if (first) handleNav(firstMatchKey(first));
      }}
      className="mb-3"
    />
  );

  // ── Sidebar nav ──────────────────────────────────────────────────────────────
  const SidebarNav = () => (
    <nav className="w-full">
      {query && searchedGroups.length === 0 ? (
        <div className="px-2 text-[13px] text-[var(--ant-color-text-tertiary)]">{tNav('search_empty')}</div>
      ) : null}
      {searchedGroups.map((group) => {
        return (
          <div key={group.id} className="mb-[18px]">
            {/* Group label — matches main sidebar's section label style */}
            <div className="mb-0.5 px-2 text-[11px] font-semibold text-[var(--ant-color-text-quaternary)]">
              {group.label}
            </div>
            {group.pages.map((page) => {
              const isActive = activePage?.id === page.id;
              return (
                <Tooltip key={page.id} title={page.description} placement="right" mouseEnterDelay={0.7}>
                  <button
                    type="button"
                    onClick={() => handleNav(firstMatchKey(page))}
                    className={[
                      'relative flex w-full cursor-pointer items-center gap-2 rounded-md border-0 px-2 py-1.5 text-left text-[13px]',
                      'transition-colors duration-150',
                      isActive
                        ? 'bg-[var(--ant-color-primary-bg)] font-semibold text-[var(--ant-color-primary)]'
                        : 'bg-transparent font-normal text-[var(--ant-color-text-secondary)] hover:bg-[var(--ant-color-fill-tertiary)] hover:text-[var(--ant-color-text)]',
                    ].join(' ')}
                  >
                    <span className="shrink-0 text-sm leading-none">
                      {page.items[0].key === 'organization' && orgNavIcon ? orgNavIcon : page.icon}
                    </span>
                    <span className="leading-[1.3]">{page.label}</span>
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
          <div className="mb-3 px-2">
            <span className="text-sm font-bold text-[var(--ant-color-text)]">{tNav('title')}</span>
          </div>
          <div className="px-2">{navSearch}</div>
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
            <span>{activePage?.label || activeItem?.label || tNav('title')}</span>
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
                <span className="text-sm font-bold text-[var(--ant-color-text)]">{tNav('title')}</span>
                <button
                  type="button"
                  aria-label={tNav('close_nav')}
                  onClick={() => setMobileSidebarOpen(false)}
                  className="cursor-pointer border-0 bg-transparent text-base text-[var(--ant-color-text-tertiary)] hover:text-[var(--ant-color-text)]"
                >
                  <CloseOutlined />
                </button>
              </div>
              <div className="px-2">{navSearch}</div>
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
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="m-0 text-[18px] font-semibold leading-[1.3] text-[var(--ant-color-text)]">
                    {activePage?.label ?? activeItem.label}
                  </h2>
                  {(activePage?.description ?? activeItem.description) && (
                    <Tooltip title={activePage?.description ?? activeItem.description} placement="bottomLeft">
                      <InfoCircleOutlined tabIndex={0} className="cursor-help text-sm text-[var(--ant-color-text-tertiary)]" />
                    </Tooltip>
                  )}
                </div>

                {/* Right: tab action button — registered by each tab via onSetAction */}
                {pageAction && <div className="hidden shrink-0 md:block">{pageAction}</div>}
              </div>

              {/* A page with several settings: underline tabs (sections), whose rule is the page divider.
                  Pills are kept for switching views of the same content, never for sections. */}
              {activePage && activePage.items.length > 1 ? (
                <Tabs
                  className="settings-page-tabs mt-2"
                  activeKey={activeTab}
                  onChange={(v) => handleNav(String(v))}
                  items={activePage.items.map((item) => ({
                    key: item.key,
                    label: (
                      <Tooltip title={item.description} mouseEnterDelay={0.7}>
                        <span>{item.label}</span>
                      </Tooltip>
                    ),
                  }))}
                />
              ) : (
                <div className="mt-3.5 border-b border-[var(--ant-color-border)]" />
              )}
            </div>
          )}

          {/* Tab content */}
          {activeItem?.requiredFeature && !isSelfHostMode ? (
            <FeatureGate feature={activeItem.requiredFeature} key={activeTab}>
              <ActiveComponent onSetAction={handleSetAction} />
            </FeatureGate>
          ) : (
            <ActiveComponent key={activeTab} onSetAction={handleSetAction} />
          )}
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
