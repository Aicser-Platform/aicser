'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Tabs, Typography, Row, Col, Statistic } from 'antd';
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
  CreditCardOutlined,
} from '@ant-design/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePlanRestrictions } from '@/hooks/usePlanRestrictions';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import nextDynamic from 'next/dynamic';
const PricingModal = nextDynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.PricingModalEE }))) as any,
  { ssr: false }
) as React.ComponentType<{ visible?: boolean; onClose?: () => void; onUpgrade?: (planType: string, isYearly: boolean) => void; currentPlan?: string; loading?: boolean }>;

// Import tab components
import { ProfileTab } from './components/ProfileTab';
import { SecurityTab } from './components/SecurityTab';
import { NotificationsTab } from './components/NotificationsTab';
import { ApiKeysTab } from './components/ApiKeysTab';
import { DataSourcesTab } from './components/DataSourcesTab';
import { GeneralTab } from './components/GeneralTab';

const OrganizationTab = nextDynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.OrganizationSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType;
const TeamTab = nextDynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.TeamSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType;
const IntegrationTab = nextDynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.IntegrationSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType;
const SubscriptionTab = nextDynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.SubscriptionSettingsTab }))) as any,
  { ssr: false }
) as React.ComponentType;

const { Title, Text } = Typography;
const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

type PlanKey = 'free' | 'pro' | 'team' | 'enterprise';

const PLAN_SUMMARY_META: Record<PlanKey, { tagColor: string; dataHistoryDays: number; includedSeats: number }> = {
  free: { tagColor: 'default', dataHistoryDays: 7, includedSeats: 1 },
  pro: { tagColor: 'blue', dataHistoryDays: 180, includedSeats: 1 },
  team: { tagColor: 'purple', dataHistoryDays: 365, includedSeats: 5 },
  enterprise: { tagColor: 'gold', dataHistoryDays: -1, includedSeats: -1 },
};

export const dynamic = 'force-dynamic';

// Tab order: General → Profile → Security → Notifications → API Keys → Data Sources, plus EE workspace tabs.
const BASE_TABS = [
  'general',
  'profile',
  'security',
  'notifications',
  'api-keys',
  'data-sources',
];
const EE_TABS = ['organization', 'team', 'integrations', 'billing-subscription'];
const VALID_TABS = [...BASE_TABS, ...(isEnterpriseEdition ? EE_TABS : [])];

const SettingsPage: React.FC = () => {
  const t = useTranslations('settings');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { planType } = usePlanRestrictions();
  const { currentProject } = useProjectStore();
  const { currentOrganization } = useOrganizationStore();

  const [pricingModalVisible, setPricingModalVisible] = useState(false); // kept as no-op; EE modal renders null

  const {
    activeTab,
    teamMembers,
    dataSources,
    apiKeys,
    setActiveTab,
    loadSettingsByTab,
    loadApiKeys,
    loadTeamMembers,
    loadDataSources,
  } = useSettingsStore();
  // Sync URL ?tab= with store so /settings?tab=general works
  useEffect(() => {
    const tab = searchParams?.get('tab');
    if (tab && VALID_TABS.includes(tab)) {
      setActiveTab(tab);
    } else if (!VALID_TABS.includes(activeTab)) {
      setActiveTab('general');
    }
  }, [activeTab, searchParams, setActiveTab]);

  // Load overview data (counts) when settings page mounts; use current project for data sources to match /data page
  useEffect(() => {
    loadApiKeys();
    loadTeamMembers(currentOrganization?.id);
    loadDataSources(currentProject?.id as string | undefined);
  }, [loadApiKeys, loadTeamMembers, loadDataSources, currentOrganization?.id, currentProject?.id]);

  useEffect(() => {
    if (!isEnterpriseEdition && EE_TABS.includes(activeTab)) return;
    loadSettingsByTab(activeTab, currentOrganization?.id, { projectId: currentProject?.id as string | undefined });
  }, [activeTab, loadSettingsByTab, currentOrganization?.id, currentProject?.id]);

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    router.replace(`/settings?tab=${key}`, { scroll: false });
  };

  const overviewStats = useMemo(
    () => ({
      members: teamMembers.length,
      activeMembers: teamMembers.filter((m) => m.is_active).length,
      dataSources: dataSources.length,
      apiKeys: apiKeys.length,
    }),
    [teamMembers, dataSources, apiKeys]
  );

  const planUsage = useMemo(() => {
    const aiLimit = 0;
    const storageLimitMb = 0;
    const storageLimitGb = storageLimitMb > 0 ? storageLimitMb / 1024 : storageLimitMb;
    const projectLimit = 0;

    const aiUsed = 0;
    const storageUsedGb = 0;
    const projectsUsed = 0;

    const aiPercent = aiLimit > 0 ? Math.min(100, (aiUsed / aiLimit) * 100) : 0;
    const storagePercent = storageLimitGb > 0 ? Math.min(100, (storageUsedGb / storageLimitGb) * 100) : 0;
    const projectPercent = projectLimit > 0 ? Math.min(100, (projectsUsed / projectLimit) * 100) : 0;

    return {
      planLabel: (planType || 'free').toUpperCase(),
      ai: { used: aiUsed, limit: aiLimit, percent: aiPercent },
      storage: { used: storageUsedGb, limit: storageLimitGb, percent: storagePercent },
      projects: { used: projectsUsed, limit: projectLimit, percent: projectPercent },
    };
  }, [planType]);

  const planKey: PlanKey = ['free', 'pro', 'team', 'enterprise'].includes(planType || '')
    ? (planType as PlanKey)
    : 'free';
  const planMeta = PLAN_SUMMARY_META[planKey];
  const planTagColor = planMeta.tagColor;

  const tabContentStyle = { paddingTop: 24, paddingBottom: 24 };

  const baseTabItems = [
    {
      key: 'general',
      label: (
        <span>
          <SettingOutlined /> {t('tab_general')}
        </span>
      ),
      children: (
        <div style={tabContentStyle}>
          <GeneralTab />
        </div>
      ),
    },
    {
      key: 'profile',
      label: (
        <span>
          <UserOutlined /> {t('tab_profile')}
        </span>
      ),
      children: (
        <div style={tabContentStyle}>
          <ProfileTab />
        </div>
      ),
    },
    {
      key: 'security',
      label: (
        <span>
          <SecurityScanOutlined /> {t('tab_security')}
        </span>
      ),
      children: (
        <div style={tabContentStyle}>
          <SecurityTab />
        </div>
      ),
    },
    {
      key: 'notifications',
      label: (
        <span>
          <BellOutlined /> {t('tab_notifications')}
        </span>
      ),
      children: (
        <div style={tabContentStyle}>
          <NotificationsTab />
        </div>
      ),
    },
    {
      key: 'api-keys',
      label: (
        <span>
          <KeyOutlined /> {t('tab_api_keys')}
        </span>
      ),
      children: (
        <div style={tabContentStyle}>
          <ApiKeysTab />
        </div>
      ),
    },
    {
      key: 'data-sources',
      label: (
        <span>
          <DatabaseOutlined /> {t('tab_data_sources')}
        </span>
      ),
      children: (
        <div style={tabContentStyle}>
          <DataSourcesTab />
        </div>
      ),
    },
  ];
  const eeTabItems = [
    {
      key: 'organization',
      label: (
        <span>
          <BankOutlined /> {t('tab_organization')}
        </span>
      ),
      children: (
        <div style={tabContentStyle}>
          <OrganizationTab />
        </div>
      ),
    },
    {
      key: 'team',
      label: (
        <span>
          <TeamOutlined /> {t('tab_team')}
        </span>
      ),
      children: (
        <div style={tabContentStyle}>
          <TeamTab />
        </div>
      ),
    },
    {
      key: 'integrations',
      label: (
        <span>
          <LinkOutlined /> {t('tab_integrations')}
        </span>
      ),
      children: (
        <div style={tabContentStyle}>
          <IntegrationTab />
        </div>
      ),
    },
    {
      key: 'billing-subscription',
      label: (
        <span>
          <CreditCardOutlined /> {t('tab_billing')}
        </span>
      ),
      children: (
        <div style={tabContentStyle}>
          <SubscriptionTab />
        </div>
      ),
    },
  ];
  const tabItems = isEnterpriseEdition ? [...baseTabItems, ...eeTabItems] : baseTabItems;

  return (
    <div className="settings-page p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="space-y-1">
        <Title level={3} style={{ marginBottom: 0, fontWeight: 600 }}>
          {t('title')}
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('page_subtitle')}
        </Text>
      </div>

      {/* Overview Stats - minimal borders */}
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" bordered={false} style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}>
            <Statistic
              title={t('overview_team_members')}
              value={overviewStats.members}
              prefix={<TeamOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
            <Text type="secondary" className="text-xs">
              {t('overview_active_suffix', { count: overviewStats.activeMembers })}
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" bordered={false} style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}>
            <Statistic
              title={t('overview_data_sources')}
              value={overviewStats.dataSources}
              prefix={<DatabaseOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
            <Text type="secondary" className="text-xs">
              {t('overview_all_operational')}
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card size="small" bordered={false} style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}>
            <Statistic
              title={t('overview_api_keys')}
              value={overviewStats.apiKeys}
              prefix={<KeyOutlined />}
              valueStyle={{ color: '#722ed1' }}
            />
            <Text type="secondary" className="text-xs">
              {overviewStats.apiKeys === 0
                ? t('overview_api_keys_none')
                : t('overview_api_keys_active', { count: overviewStats.apiKeys })}
            </Text>
          </Card>
        </Col>
      </Row>

      {/* Settings Tabs - scrollable on mobile; destroyInactiveTabPane for faster load */}
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={tabItems}
        type="card"
        size="middle"
        className="settings-tabs"
        style={{ marginTop: 24 }}
        tabBarStyle={{ marginBottom: 0 }}
        destroyInactiveTabPane
        tabBarGutter={12}
      />

      <PricingModal
        visible={pricingModalVisible}
        onClose={() => setPricingModalVisible(false)}
        onUpgrade={() => setPricingModalVisible(false)}
        currentPlan={planType}
        loading={false}
      />
    </div>
  );
};

export default SettingsPage;
