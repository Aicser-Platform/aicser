import React from 'react';
import {
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SunOutlined,
  BgColorsOutlined,
  FolderOutlined,
  DownOutlined,
  SettingOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { Badge, Button, Layout, Tooltip, Modal, Form, Input, Typography, message, Dropdown } from 'antd';
const { Text } = Typography;
import { LocaleFlagIcon } from '@/components/LocaleFlagIcon/LocaleFlagIcon';
import UserProfileDropdown from '@/components/UserProfileDropdown';
import { useLocale, useTranslations } from 'next-intl';
import { LOCALE_OPTIONS, getLocaleLabel, getLocaleMeta } from '@/config/locales';
import { useThemeMode } from '@/components/Providers/ThemeModeContext';
import { fetchApi, handlePlanLimitError } from '@/utils/api';
import dynamic from 'next/dynamic';

const ProjectSelectorModal = dynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.ProjectSelectorModal }))) as any,
  { ssr: false }
) as React.ComponentType<{ open?: boolean; onClose?: () => void; onProjectChange?: (projectId: string | number) => void; onCreateNew?: () => void; [key: string]: unknown }>;
const ActivityInboxBell = dynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.ActivityInboxBell }))) as any,
  { ssr: false }
) as React.ComponentType;
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useProjects, useCreateProject } from '@/hooks/useProjects';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useOrganizations, useCreateOrganization } from '@/hooks/useOrganizations';
import { useHeaderStore } from '@/stores/useHeaderStore';
import { useConversationStore } from '@/stores/useConversationStore';
import { Divider } from 'antd';
import { useRouter } from 'next/navigation';
const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);
type Props = {
  isBreakpoint: boolean;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  onOpenDataSourceModal?: () => void;
  /** When true, show a dot on Connect Data Source so first-time users notice it (no data sources yet). */
  highlightConnectData?: boolean;
};

export const LayoutHeader: React.FC<Props> = ({
  isBreakpoint,
  collapsed,
  setCollapsed,
  onOpenDataSourceModal,
  highlightConnectData = false,
}) => {
  const router = useRouter();
  const t = useTranslations('header');

  const { isDarkMode, setIsDarkMode } = useThemeMode();

  const ThemeCustomizer = React.useMemo(
    () => dynamic(() => import('@/ee').then((m) => ({ default: m.ThemeCustomizer })), { ssr: false }),
    []
  );
  const [customizerOpen, setCustomizerOpen] = React.useState(false);

  const { currentProject, selectProject } = useProjectStore();

  const { createConversation } = useConversationStore();

  const currentLocale = useLocale();

  const handleLanguageChange = async (locale: string) => {
    try {
      await fetchApi('users/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: locale }),
      });
      // Fire custom event for LocaleProvider to pick up
      window.dispatchEvent(new CustomEvent('aiser-locale-change', { detail: locale }));
      message.success(t('language_switched', { language: getLocaleLabel(locale) }));
    } catch (err) {
      message.error(t('language_switch_failed'));
    }
  };

  const { user } = useAuth();
  const userWithId = user as { id?: string };

  const handleProjectSettings = () => {
    if (isEnterpriseEdition && currentProject) {
      router.push('/projects');
    }
  };
  // Organization state
  const { currentOrganization, setCurrentOrganization } = useOrganizationStore();
  const { organizations, isLoading: orgLoading } = useOrganizations({ enabled: isEnterpriseEdition });
  const createOrgMutation = useCreateOrganization();

  // Project state (depends on currentOrganization being declared first)
  const { projects, isLoading: projectsLoading } = useProjects(
    isEnterpriseEdition ? currentOrganization?.id : undefined
  );
  const createProjectMutation = useCreateProject();

  // UI state for modals
  const [projectModalOpen, setProjectModalOpen] = React.useState(false);
  const [createProjectModalOpen, setCreateProjectModalOpen] = React.useState(false);
  const [createOrgModalOpen, setCreateOrgModalOpen] = React.useState(false);
  const [createLoading, setCreateLoading] = React.useState(false);
  const [createOrgLoading, setCreateOrgLoading] = React.useState(false);
  const [createForm] = Form.useForm();
  const [orgForm] = Form.useForm();

  const { extraLeft, extraRight } = useHeaderStore();

  // Auto-select organization and show create modal when needed
  React.useEffect(() => {
    if (!isEnterpriseEdition) return;
    if (!userWithId?.id || orgLoading) return;
    if (organizations.length === 0) {
      setCreateOrgModalOpen(true);
    } else if (!currentOrganization) {
      setCurrentOrganization(organizations[0]);
    }
  }, [userWithId?.id, orgLoading, organizations, currentOrganization, setCurrentOrganization]);

  // Auto-select first project if none is selected
  React.useEffect(() => {
    if (!projectsLoading && projects.length > 0 && !currentProject) {
      selectProject(projects[0]);
    }
  }, [projectsLoading, projects, currentProject, selectProject]);

  const handleProjectChange = (projectId: number | string) => {
    const project = projects.find((p) => p.id == projectId);
    if (project) {
      message.loading({ content: t('switching_project'), key: 'project-switch' });
      selectProject(project);
      message.success({ content: t('switched_to', { name: project.name }), key: 'project-switch', duration: 2 });
    } else {
      message.error({ content: t('switch_failed'), key: 'project-switch', duration: 2 });
    }
  };

  const handleCreateProject = async (values: any) => {
    try {
      setCreateLoading(true);
      const newProject = await createProjectMutation.mutateAsync({
        ...values,
        organization_id: currentOrganization?.id,
      });

      if (newProject) {
        selectProject(newProject);
        setCreateProjectModalOpen(false);
        createForm.resetFields();
        message.success({ content: t('project_created'), key: 'project-create', duration: 2 });

        const conversation = await createConversation({
          project_id: newProject.id,
          title: t('new_conversation'),
        } as any);
        if (conversation) {
          router.push('/chat');
        }
      }
    } catch (error: any) {
      // Plan limit errors show a clean upgrade modal
      if (handlePlanLimitError(error)) {
        // Handled — upgrade modal shown
      } else {
        console.error('Failed to create project:', error);
        message.error(t('failed_create_project'));
      }
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCreateOrganization = async (values: any) => {
    try {
      setCreateOrgLoading(true);
      const newOrg = await createOrgMutation.mutateAsync(values);
      if (newOrg) {
        setCreateOrgModalOpen(false);
        orgForm.resetFields();
      }
    } catch (error) {
      console.error('Failed to create organization:', error);
    } finally {
      setCreateOrgLoading(false);
    }
  };

  const sidebarOffset = React.useMemo(() => (isBreakpoint ? 0 : collapsed ? 80 : 256), [collapsed, isBreakpoint]);

  const headerGradient =
    'linear-gradient(135deg, var(--color-bg-navigation-header, var(--color-bg-navigation)) 0%, var(--color-bg-navigation-header-glow, rgba(255,255,255,0.25)) 100%)';

  return (
    <Layout.Header
      style={{
        padding: '0 16px', // Ant Design: 16px horizontal (2 * 8px)
        height: '64px',
        minHeight: '64px',
        maxHeight: '64px',
        lineHeight: '64px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'fixed',
        top: 0,
        left: `${sidebarOffset}px`,
        right: 0,
        zIndex: 1001,
        transition: 'all 0.2s ease',
        background: headerGradient,
        borderBottom: '1px solid var(--ant-color-border)',
        color: 'var(--ant-color-text)',
        margin: 0,
        paddingTop: 0,
        paddingBottom: 0,
        width: 'auto',
        boxShadow: 'none',
        boxSizing: 'border-box',
        borderTop: 'none',
        borderRight: 'none',
        borderLeft: 'none',
      }}
    >
      <div
        className="header-left"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0px',
          marginLeft: collapsed ? '0px' : '0px',
          transition: 'margin-left 0.2s ease',
        }}
      >
        {/* Sidebar toggle */}
        <Tooltip title={collapsed ? t('open_sidebar') : t('collapse_sidebar')}>
          <Button
            type="text"
            icon={isBreakpoint ? <MenuOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? t('open_sidebar') : t('collapse_sidebar')}
            className="sidebar-toggle"
            style={{
              fontSize: '18px',
              width: 48,
              height: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--radius-base)',
              transition: 'all var(--transition-fast)',
            }}
          />
        </Tooltip>

        {isEnterpriseEdition && (
          <>
            <Tooltip title={t('switch_project')}>
              <Button
                type="text"
                icon={<FolderOutlined />}
                onClick={() => setProjectModalOpen(true)}
                style={{
                  fontSize: '14px',
                  height: 40,
                  padding: '0 16px',
                  borderRadius: 'var(--radius-base)',
                  transition: 'all var(--transition-fast)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentProject
                    ? currentProject.is_private && currentProject.owner_name
                      ? `${currentProject.name} (${currentProject.owner_name})`
                      : currentProject.name
                    : t('select_project')}
                </span>
                <DownOutlined style={{ fontSize: '12px' }} />
              </Button>
            </Tooltip>
            <Tooltip title={t('project_settings')}>
              <Button
                type="text"
                icon={<SettingOutlined />}
                onClick={handleProjectSettings}
                style={{
                  fontSize: '18px',
                  width: 40,
                  height: 40,
                  borderRadius: 'var(--radius-base)',
                  transition: 'all var(--transition-fast)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              />
            </Tooltip>
          </>
        )}

        {extraLeft && <>{extraLeft}</>}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      <div
        className="header-right"
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'center',
        }}
      >
        {/* Divider */}
        <div
          style={{
            width: '1px',
            height: '32px',
            background: 'var(--ant-color-border)',
            margin: '0 var(--space-2)',
          }}
        />

        {extraRight}

        {/* Theme Controls & Profile */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {onOpenDataSourceModal && (
            <Tooltip
              title={highlightConnectData ? t('connect_first_data_source') : t('connect_data_source')}
              placement="bottom"
            >
              <Badge dot={highlightConnectData} status="processing" offset={[-2, 2]}>
                <Button
                  type="text"
                  icon={<PlusOutlined style={{ fontSize: 18, color: 'var(--ant-color-primary)' }} />}
                  onClick={onOpenDataSourceModal}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-base)',
                    transition: 'all var(--transition-fast)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                />
              </Badge>
            </Tooltip>
          )}
          {isEnterpriseEdition && <ActivityInboxBell />}

          {isEnterpriseEdition && (
            <Tooltip title={t('customize_theme')}>
              <Button
                type="text"
                icon={<BgColorsOutlined />}
                onClick={() => setCustomizerOpen(true)}
                style={{
                  fontSize: '18px',
                  width: 40,
                  height: 40,
                  borderRadius: 'var(--radius-base)',
                  transition: 'all var(--transition-fast)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              />
            </Tooltip>
          )}

          <Tooltip title={isDarkMode ? t('light_mode') : t('dark_mode')}>
            <Button
              type="text"
              icon={isDarkMode ? <SunOutlined /> : <MoonOutlined />}
              onClick={() => {
                const next = !isDarkMode;
                setIsDarkMode(next);
                // Sync theme to backend so Settings → General stays in sync
                fetchApi('users/settings', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ theme: next ? 'dark' : 'light' }),
                }).catch(() => { });
              }}
              aria-label={isDarkMode ? t('light_mode') : t('dark_mode')}
              style={{
                fontSize: '16px',
                width: 40,
                height: 40,
                borderRadius: 'var(--radius-base)',
                transition: 'all var(--transition-fast)',
              }}
            />
          </Tooltip>

          <Dropdown
            menu={{
              items: LOCALE_OPTIONS.map((opt) => ({
                key: opt.value,
                label: (
                  <Tooltip
                    title={t('language_item_tooltip', { native: opt.nativeName, region: opt.regionEn })}
                    placement="left"
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '-4px -12px', padding: '4px 12px' }}
                    >
                      <LocaleFlagIcon
                        locale={opt.value}
                        width={22}
                        title={`${opt.nativeName} — ${opt.regionEn}`}
                      />
                      <span>{opt.label}</span>
                    </div>
                  </Tooltip>
                ),
                onClick: () => handleLanguageChange(opt.value),
              })),
              selectedKeys: [currentLocale],
            }}
            placement="bottomRight"
            trigger={['click']}
          >
            <Tooltip
              title={t('language_button_tooltip', { language: getLocaleLabel(currentLocale) })}
              placement="bottom"
            >
              <Button
                type="text"
                icon={
                  <LocaleFlagIcon
                    locale={currentLocale}
                    width={22}
                    title={`${getLocaleMeta(currentLocale).nativeName} — ${getLocaleMeta(currentLocale).regionEn}`}
                  />
                }
                aria-label={`${t('select_language')}: ${getLocaleLabel(currentLocale)}`}
                style={{
                  width: 44,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-base)',
                  padding: 0,
                }}
              />
            </Tooltip>
          </Dropdown>

          <UserProfileDropdown showText={false} />
        </div>
      </div>

      {/* Theme Customizer Drawer */}
      {isEnterpriseEdition && <ThemeCustomizer open={customizerOpen} onClose={() => setCustomizerOpen(false)} />}

      {isEnterpriseEdition && (
        <ProjectSelectorModal
          open={projectModalOpen}
          onClose={() => setProjectModalOpen(false)}
          onProjectChange={handleProjectChange}
          onCreateNew={() => setCreateProjectModalOpen(true)}
        />
      )}

      {/* Create Project Modal */}
      {isEnterpriseEdition && (
        <Modal
          title={t('create_new_project')}
          open={createProjectModalOpen}
          onCancel={() => setCreateProjectModalOpen(false)}
          footer={null}
          width={600}
        >
          {!currentOrganization ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>
              <Text type="warning">{t('create_org_first')}</Text>
            </div>
          ) : (
            <Form
              form={createForm}
              layout="vertical"
              onFinish={handleCreateProject}
              initialValues={{ category: 'general', is_public: false }}
            >
              <Form.Item
                name="name"
                label={t('project_name')}
                rules={[
                  { required: true, message: t('project_name_required') },
                  { whitespace: true, message: t('project_name_blank') },
                  { max: 60, message: t('project_name_max') },
                  {
                    validator: (_: unknown, value: string) => {
                      if (value && value.trim().toLowerCase() === 'my project') {
                        return Promise.reject(new Error(t('project_name_reserved')));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Input placeholder={t('project_name_placeholder')} maxLength={60} showCount />
              </Form.Item>
              <Form.Item name="description" label={t('optional_description')}>
                <Input.TextArea rows={3} placeholder={t('describe_project')} />
              </Form.Item>
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary">
                  {t('organization_name')}: <Text strong>{currentOrganization.name}</Text>
                </Text>
              </div>
              <div style={{ textAlign: 'right', marginTop: 16 }}>
                <Button onClick={() => setCreateProjectModalOpen(false)} style={{ marginRight: 8 }}>
                  {t('cancel')}
                </Button>
                <Button type="primary" htmlType="submit" loading={createLoading}>
                  {t('create_project_button')}
                </Button>
              </div>
            </Form>
          )}
        </Modal>
      )}
      {/* Create Organization Modal (Required for new EE users) */}
      {isEnterpriseEdition && (
        <Modal
          title={t('create_organization')}
          open={createOrgModalOpen}
          closable={organizations.length > 0} // Only allow close if user already has an org
          maskClosable={organizations.length > 0}
          onCancel={() => organizations.length > 0 && setCreateOrgModalOpen(false)}
          footer={null}
          width={500}
        >
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">{t('welcome_org')}</Text>
          </div>
          <Form form={orgForm} layout="vertical" onFinish={handleCreateOrganization}>
            <Form.Item
              name="name"
              label={t('organization_name')}
              rules={[{ required: true, message: t('org_name_required') }]}
            >
              <Input placeholder={t('org_name_placeholder')} />
            </Form.Item>
            <Form.Item name="description" label={t('optional_description')}>
              <Input.TextArea rows={3} placeholder={t('optional_description')} />
            </Form.Item>
            <div style={{ textAlign: 'right', marginTop: 16 }}>
              <Button type="primary" htmlType="submit" loading={createOrgLoading} block>
                {t('create_organization_button')}
              </Button>
            </div>
          </Form>
        </Modal>
      )}
    </Layout.Header>
  );
};
