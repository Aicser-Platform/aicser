'use client';

/**
 * Global ⌘K / Ctrl+K command palette — quick keyboard-first navigation to
 * top-level app sections, Settings sub-tabs, and recent projects.
 *
 * Mounted once in the dashboard layout (client/src/app/(dashboard)/layout.tsx)
 * so it's available from anywhere in the authenticated app.
 */

import { useOrgMenu } from '@/hooks/useOrgMenu';
import { usePermissions } from '@/hooks/usePermissions';
import { Permission } from '@/constants/permissions';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Input, Empty, Typography, Tag } from 'antd';
import {
  SearchOutlined,
  MessageOutlined,
  CodeOutlined,
  AppstoreOutlined,
  DashboardOutlined,
  AreaChartOutlined,
  DatabaseOutlined,
  BookOutlined,
  BellOutlined,
  SettingOutlined,
  CreditCardOutlined,
  LineChartOutlined,
  UserOutlined,
  LockOutlined,
  ProjectOutlined,
  BankOutlined,
  TeamOutlined,
  SecurityScanOutlined,
  SafetyCertificateOutlined,
  LinkOutlined,
  KeyOutlined,
  AuditOutlined,
  ThunderboltOutlined,
  ApartmentOutlined,
  SafetyOutlined,
  FileTextOutlined,
  FolderOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { fetchApi } from '@/utils/api';
import { flattenNavLinks, buildEnterpriseSidebarItems, buildCommunitySidebarItems, linkAllowed, NAV_LABEL_KEYS } from '@/layouts/Navigation/navConfig';
import { isEnterpriseEdition as getIsEnterpriseEdition } from '@/utils/appPaths';
import { isAiFrontendEnabled } from '@/utils/aiAvailability';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useProjects } from '@/hooks/useProjects';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { dataSourceKeys } from '@/hooks/dataSourceKeys';
import { useConversationStore } from '@/stores/useConversationStore';
import type { Project } from '@/types/project';

const { Text } = Typography;

const isEnterpriseEdition = getIsEnterpriseEdition();

// What each kind of search result is: its icon, and the sidebar word for it when it has no location.
const ASSET_ICONS: Record<string, React.ReactNode> = {
  dashboard: <DashboardOutlined />,
  chart: <AreaChartOutlined />,
  metric: <LineChartOutlined />,
  table: <DatabaseOutlined />,
  data_source: <DatabaseOutlined />,
  library: <BookOutlined />,
  recipe: <FileTextOutlined />,
};
const ASSET_LABEL: Record<string, string> = {
  dashboard: NAV_LABEL_KEYS.dashboards,
  chart: NAV_LABEL_KEYS['chart-designer'],
  data_source: NAV_LABEL_KEYS.data,
  metric: NAV_LABEL_KEYS['semantic-layer'],
  recipe: NAV_LABEL_KEYS.prepare,
};

type PaletteGroup = 'assets' | 'nav' | 'settings' | 'projects';
type AssetHit = { type: string; id: string; name: string; context?: string | null; href: string };

interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  description?: string;
  icon: React.ReactNode;
  keywords?: string;
  onSelect: () => void;
}

const NAV_ICONS: Record<string, React.ReactNode> = {
  chat: <MessageOutlined />,
  dashboards: <DashboardOutlined />,
  feed: <AppstoreOutlined />,
  'chart-designer': <AreaChartOutlined />,
  'query-editor': <CodeOutlined />,
  data: <DatabaseOutlined />,
  knowledge: <BookOutlined />,
  alerts: <BellOutlined />,
  settings: <SettingOutlined />,
  billing: <CreditCardOutlined />,
};

/** Mirrors the tab list in client/src/app/(dashboard)/settings/page.tsx (NAV_GROUPS) —
 * kept as a static list here rather than importing that route module, so the palette
 * (mounted globally) doesn't pull the settings page's EE tab bundles into every page. */
const SETTINGS_TABS: Array<{ key: string; labelKey: string; icon: React.ReactNode; eeOnly?: boolean }> = [
  { key: 'profile', labelKey: 'tab_profile', icon: <UserOutlined /> },
  { key: 'security', labelKey: 'tab_security', icon: <LockOutlined />, eeOnly: true },
  { key: 'general', labelKey: 'tab_general', icon: <SettingOutlined /> },
  { key: 'project', labelKey: 'tab_project', icon: <ProjectOutlined />, eeOnly: true },
  { key: 'organization', labelKey: 'tab_organization', icon: <BankOutlined />, eeOnly: true },
  { key: 'team', labelKey: 'tab_team', icon: <TeamOutlined />, eeOnly: true },
  { key: 'roles', labelKey: 'tab_roles', icon: <SecurityScanOutlined />, eeOnly: true },
  { key: 'usage', labelKey: 'tab_usage', icon: <LineChartOutlined /> },
  { key: 'billing-subscription', labelKey: 'tab_billing', icon: <CreditCardOutlined />, eeOnly: true },
  { key: 'license', labelKey: 'tab_license', icon: <SafetyCertificateOutlined />, eeOnly: true },
  { key: 'integrations', labelKey: 'tab_integrations', icon: <LinkOutlined />, eeOnly: true },
  { key: 'api-keys', labelKey: 'tab_api_keys', icon: <KeyOutlined /> },
  { key: 'embed', labelKey: 'tab_embed', icon: <CodeOutlined />, eeOnly: true },
  { key: 'audit', labelKey: 'tab_audit', icon: <AuditOutlined />, eeOnly: true },
  { key: 'agent-skills', labelKey: 'tab_agent_skills', icon: <ThunderboltOutlined />, eeOnly: true },
  { key: 'agent-workflows', labelKey: 'tab_agent_workflows', icon: <ApartmentOutlined />, eeOnly: true },
  { key: 'agent-capabilities', labelKey: 'tab_agent_capabilities', icon: <SafetyOutlined />, eeOnly: true },
  { key: 'briefings', labelKey: 'tab_briefings', icon: <FileTextOutlined />, eeOnly: true },
];

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  // Works from text boxes too (Ask's box usually has focus). Only code editors keep the key:
  // Monaco's own chorded bindings use it (e.g. Ctrl+K Ctrl+S).
  if (el.closest('.monaco-editor')) return true;
  return false;
}

export const CommandPalette: React.FC = () => {
  const t = useTranslations('command_palette');
  const tNav = useTranslations('nav');
  const tSettings = useTranslations('settings');
  const router = useRouter();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const currentOrganization = useOrganizationStore((s) => s.currentOrganization);
  const { currentProject, selectProject } = useProjectStore();
  const { projects } = useProjects(isEnterpriseEdition ? currentOrganization?.id : undefined);

  const showAiNav = isEnterpriseEdition && isAiFrontendEnabled();

  const close = useCallback(() => setOpen(false), []);

  // Global ⌘K / Ctrl+K toggle — works from anywhere in the authenticated app.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 'k') {
        if (isTypingTarget(document.activeElement)) return;
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
    };
    const onOpenRequest = () => setOpen(true); // the header's Search control
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('open-command-palette', onOpenRequest);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('open-command-palette', onOpenRequest);
    };
  }, []);

  // Beyond pages: the things people named (dashboards, charts, metrics, tables), from the catalog
  // search, which only returns what this person may open.
  const [assets, setAssets] = useState<AssetHit[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!open || !isEnterpriseEdition || q.length < 2) {
      setAssets([]);
      return;
    }
    let stale = false;
    const id = setTimeout(() => {
      fetchApi<{ items?: AssetHit[]; results?: AssetHit[] }>(`/api/catalog/assets?q=${encodeURIComponent(q)}&limit=8${currentProject?.id ? `&project_id=${currentProject.id}` : ''}`)
        .then((r) => { if (!stale) setAssets(r.items ?? r.results ?? []); })
        .catch(() => { if (!stale) setAssets([]); });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(id);
    };
  }, [open, query, currentProject?.id]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  const handleSelectProject = useCallback(
    (project: Project) => {
      message.loading({ content: t('switching_project'), key: 'palette-project-switch' });
      selectProject(project);
      useDataSourceStore.getState().select(null);
      void queryClient.invalidateQueries({ queryKey: dataSourceKeys.all });
      void useConversationStore.getState().loadConversations(String(project.id));
      message.success({ content: t('switched_project', { name: project.name }), key: 'palette-project-switch', duration: 2 });
    },
    [selectProject, queryClient, t]
  );

  const menu = useOrgMenu();
  const { hasPermission } = usePermissions();
  const items = useMemo<PaletteItem[]>(() => {
    const navItems: PaletteItem[] = flattenNavLinks(
      isEnterpriseEdition ? buildEnterpriseSidebarItems(showAiNav) : buildCommunitySidebarItems()
    ).filter((item) => linkAllowed(item.key, { menu, isAdmin: hasPermission(Permission.ORG_EDIT) })).map((item) => ({
      id: `nav-${item.key}`,
      group: 'nav' as const,
      label: tNav(item.labelKey),
      icon: NAV_ICONS[item.key] ?? <ArrowRightOutlined />,
      onSelect: () => router.push(item.href),
    }));

    const settingsItems: PaletteItem[] = SETTINGS_TABS.filter((tab) => !tab.eeOnly || isEnterpriseEdition).map(
      (tab) => ({
        id: `settings-${tab.key}`,
        group: 'settings' as const,
        label: tSettings(tab.labelKey),
        description: tNav('settings'),
        icon: tab.icon,
        keywords: 'settings',
        onSelect: () => router.push(`/settings?tab=${tab.key}`),
      })
    );

    const projectItems: PaletteItem[] = isEnterpriseEdition
      ? (projects ?? []).map((project) => ({
          id: `project-${project.id}`,
          group: 'projects' as const,
          label: project.name,
          description: String(project.id) === String(currentProject?.id) ? t('current_project') : undefined,
          icon: <FolderOutlined style={project.color ? { color: project.color } : undefined} />,
          keywords: 'project switch',
          onSelect: () => handleSelectProject(project),
        }))
      : [];

    return [...navItems, ...settingsItems, ...projectItems];
  }, [showAiNav, tNav, tSettings, router, projects, currentProject?.id, t, handleSelectProject, menu, hasPermission]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const found: PaletteItem[] = assets.map((a) => ({
      id: `asset-${a.type}-${a.id}`,
      group: 'assets' as const,
      label: a.name,
      description: a.context || tNav(ASSET_LABEL[a.type] ?? 'data'),
      icon: ASSET_ICONS[a.type] ?? <FileTextOutlined />,
      onSelect: () => router.push(a.href),
    }));
    return [...found, ...items.filter((item) => {
      const hay = [item.label, item.description, item.keywords].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    })];
  }, [items, query, assets, router, tNav]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>('[data-active="true"]');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const activate = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      item.onSelect();
      close();
    },
    [close]
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filteredItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(filteredItems[activeIndex]);
    }
  };

  const groupLabel = (group: PaletteGroup) =>
    group === 'assets' ? t('group_assets') : group === 'nav' ? t('group_navigate') : group === 'settings' ? t('group_settings') : t('group_projects');

  let renderedGroup: PaletteGroup | null = null;

  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      closable={false}
      width={640}
      style={{ top: 96 }}
      styles={{ body: { padding: 0 } }}
      destroyOnHidden
      title={null}
      className="command-palette-modal"
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ant-color-border-secondary)' }}>
        <Input
          size="large"
          variant="borderless"
          autoFocus
          prefix={<SearchOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />}
          placeholder={t('placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
      </div>
      <div ref={listRef} style={{ maxHeight: 420, overflowY: 'auto', padding: '8px 0' }}>
        {filteredItems.length === 0 ? (
          <Empty description={t('no_results')} style={{ padding: '32px 0' }} />
        ) : (
          filteredItems.map((item, index) => {
            const showHeader = renderedGroup !== item.group;
            renderedGroup = item.group;
            const isActive = index === activeIndex;
            return (
              <React.Fragment key={item.id}>
                {showHeader && (
                  <div
                    style={{
                      padding: '6px 16px',
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: 0.4,
                      color: 'var(--ant-color-text-tertiary)',
                    }}
                  >
                    {groupLabel(item.group)}
                  </div>
                )}
                <div
                  data-active={isActive}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => activate(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 16px',
                    cursor: 'pointer',
                    background: isActive ? 'var(--ant-color-primary-bg)' : 'transparent',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 20,
                      color: isActive ? 'var(--ant-color-primary)' : 'var(--ant-color-text-secondary)',
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.label}
                    </Text>
                  </span>
                  {item.description && (
                    <Tag style={{ marginInlineEnd: 0, flexShrink: 0 }}>{item.description}</Tag>
                  )}
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '8px 16px',
          borderTop: '1px solid var(--ant-color-border-secondary)',
          fontSize: 12,
          color: 'var(--ant-color-text-tertiary)',
        }}
      >
        <span>↑↓ {t('hint_navigate')}</span>
        <span>↵ {t('hint_select')}</span>
        <span>esc {t('hint_close')}</span>
      </div>
    </Modal>
  );
};

export default CommandPalette;
