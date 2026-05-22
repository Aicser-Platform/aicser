'use client';

import React, { useState, useEffect } from 'react';
import { useDashboardStore } from '../stores/useDashboardStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { socialFeedService, type FeedVisibility } from '@/services/socialFeedService';
import { chartService, type DashboardTemplate } from '../services/chartService';
import {
  PlusOutlined,
  DownOutlined,
  DashboardOutlined,
  ExpandOutlined,
  SendOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  UnorderedListOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { Dropdown, Button, Space, Modal, Input, Select, message, Spin, Divider } from 'antd';
import './DashboardTabs.css';
import { AddBlockPopover } from './AddBlockPopover';
import { SchedulePublishModals } from './SchedulePublishModals';
import { useAutomationManager } from '../hooks/useAutomationManager';

const PUBLIC_APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

const buildSharedDashboardPath = (dashboardId?: string | null): string => {
  if (!dashboardId) return '/shared/dashboards';
  return `/shared/dashboards?id=${encodeURIComponent(dashboardId)}`;
};

const buildSharedDashboardUrl = (dashboardId?: string | null): string => {
  const path = buildSharedDashboardPath(dashboardId);
  if (typeof window === 'undefined') return path;
  const origin = window.location.origin;
  const isLocalOrigin = /localhost|127\.0\.0\.1/.test(origin);
  const resolvedOrigin = isLocalOrigin ? PUBLIC_APP_ORIGIN : origin;
  return `${resolvedOrigin}${path}`;
};
import { useTranslations } from 'next-intl';

export const DashboardTabs: React.FC = () => {
  const t = useTranslations('dashboard_tabs');
  const {
    dashboards,
    activeDashboardId,
    isSaving,
    setActiveDashboardId,
    addDashboard,
    fetchDashboards,
    addWidget: addWidgetToStore,
  } = useDashboardStore();
  const { currentProject, currentProjectId } = useProjectStore();

  const activeDashboard = dashboards.find((d) => d.id === activeDashboardId);
  const sharedDashboardPath = buildSharedDashboardPath(activeDashboardId);
  const sharedDashboardUrl = buildSharedDashboardUrl(activeDashboardId);

  const resolvedOrganizationId =
    currentProject?.organization_id || (currentProject as { organizationId?: string } | null)?.organizationId;
  const resolvedProjectId =
    currentProjectId != null
      ? String(currentProjectId)
      : currentProject?.id != null
        ? String(currentProject.id)
        : undefined;

  // Use automation manager hook
  const {
    isAutoSendOpen,
    setIsAutoSendOpen,
    isSavingAutoSend,
    autoSendForm,
    setAutoSendForm,
    openAutoSendModal,
    handleSaveAutoSend,
    externalRecipientInput,
    setExternalRecipientInput,
    addExternalRecipient,
    isAutomationListOpen,
    setIsAutomationListOpen,
    isLoadingScheduledEmails,
    scheduledEmails,
    isDeletingScheduleId,
    isTogglingScheduleId,
    handleDeleteSchedule,
    openEditAutomationModal,
    handleToggleScheduleEnabled,
    isEditAutomationOpen,
    setIsEditAutomationOpen,
    isSavingEditAutomation,
    editingAutomationForm,
    setEditingAutomationForm,
    handleUpdateSchedule,
    isLoadingOrgMembers,
    orgMemberEmails,
    orgMemberLabelMap,
    openAutomationListModal,
  } = useAutomationManager({
    activeDashboardId,
    activeDashboardName: activeDashboard?.name,
    resolvedOrganizationId,
    sharedDashboardUrl,
  });

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [sampleTemplates, setSampleTemplates] = useState<DashboardTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const [publishForm, setPublishForm] = useState<{
    title: string;
    description: string;
    tags: string[];
    visibility: FeedVisibility;
  }>({
    title: '',
    description: '',
    tags: [],
    visibility: 'organization',
  });

  // Dashboard Navigator state
  const [searchTerm, setSearchTerm] = useState('');
  const [editingDashboardId, setEditingDashboardId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [dashboardToEdit, setDashboardToEdit] = useState<{ id: string; name: string } | null>(null);
  const [newDashboardName, setNewDashboardName] = useState('');

  const { updateDashboardName, removeDashboard } = useDashboardStore();

  const handleOpenRename = (e: React.MouseEvent, dash: { id: string; name: string }) => {
    e.stopPropagation();
    setEditingDashboardId(dash.id);
    setNewDashboardName(dash.name);
  };

  const handleOpenDelete = (e: React.MouseEvent, dash: { id: string; name: string }) => {
    e.stopPropagation();
    setDashboardToEdit(dash);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmRename = async (dashId: string) => {
    if (!newDashboardName.trim()) {
      setEditingDashboardId(null);
      return;
    }
    await updateDashboardName(dashId, newDashboardName.trim());
    setEditingDashboardId(null);
    message.success('Dashboard renamed');
  };

  const handleConfirmDelete = async () => {
    if (!dashboardToEdit) return;
    try {
      await removeDashboard(dashboardToEdit.id);
      setIsDeleteModalOpen(false);
      setDashboardToEdit(null);
      message.success('Dashboard removed');
    } catch (err) {
      message.error('Failed to remove dashboard');
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fsElement =
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).msFullscreenElement;
      setIsFullscreen(!!fsElement && fsElement.classList.contains('studio-wrapper'));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('msfullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadTemplates = async () => {
      setIsLoadingTemplates(true);
      try {
        const templates = await chartService.getDashboardTemplates();
        if (!cancelled) {
          setSampleTemplates(templates);
        }
      } catch (error) {
        if (!cancelled) {
          setSampleTemplates([]);
          message.error('Unable to load sample dashboards right now. Please refresh and try again.');
        }
        console.error('Failed to load sample dashboard templates:', error);
      } finally {
        if (!cancelled) {
          setIsLoadingTemplates(false);
        }
      }
    };

    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  const createDashboardFromTemplate = async (template: DashboardTemplate) => {
    if (isEnterpriseEdition && !resolvedProjectId) {
      message.warning('Please select a project first.');
      return;
    }

    setCreatingTemplateId(template.id);
    try {
      const result = await chartService.createDashboardFromTemplate({
        templateId: template.id,
        projectId: isEnterpriseEdition ? resolvedProjectId : undefined,
        dashboardName: template.default_dashboard_name,
      });

      await fetchDashboards();

      const createdId = result?.dashboard?.id;
      if (createdId) {
        setActiveDashboardId(String(createdId));
      }

      const title = result?.dashboard?.title || template.default_dashboard_name || template.name;
      message.success(`Created ${title}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create sample dashboard';
      message.error(errorMessage);
    } finally {
      setCreatingTemplateId(null);
    }
  };

  const handleSelectBlock = (type: string) => {
    const instanceId = `w_${Date.now()}`;
    const newWidget = {
      id: instanceId,
      chartType: type as any,
      title: t('chart_title_by_type', { type: `${type.charAt(0).toUpperCase() + type.slice(1)}` }),
      chartOptions: {
        showLegend: true,
        showDataLabel: false,
        showGridline: true,
        showAxis: true,
      },
    };

    const layoutItem = {
      i: instanceId,
      x: 0,
      y: Infinity,
      w: 4,
      h: 5,
    };

    addWidgetToStore(newWidget, layoutItem);
  };

  // const openPublishModal = () => {
  //   if (!activeDashboardId || !activeDashboard) {
  //     message.warning(t('select_dashboard_first'));
  //     return;
  //   }

  //   const defaultVisibility: FeedVisibility = resolvedProjectId
  //     ? 'project'
  //     : resolvedOrganizationId
  //       ? 'organization'
  //       : 'private';

  //   setPublishForm({
  //     title: activeDashboard.name || t('dashboard'),
  //     description: '',
  //     tags: [],
  //     visibility: defaultVisibility,
  //   });
  //   setIsPublishOpen(true);
  // };

  const handlePublish = async () => {
    if (!activeDashboardId || !activeDashboard) {
      message.error(t('no_active_dashboard'));
      return;
    }
    if (!publishForm.title.trim()) {
      message.warning(t('title_required'));
      return;
    }
    if (isEnterpriseEdition) {
      if (publishForm.visibility === 'organization' && !resolvedOrganizationId) {
        message.error(t('organization_context_required'));
        return;
      }
      if (publishForm.visibility === 'project' && !resolvedProjectId) {
        message.error(t('project_context_required'));
        return;
      }
    }

    setIsPublishing(true);
    try {
      const result = await socialFeedService.publishAsset({
        asset_type: 'dashboard',
        asset_id: activeDashboardId,
        organization_id: isEnterpriseEdition ? (resolvedOrganizationId || undefined) : undefined,
        project_id: isEnterpriseEdition ? (resolvedProjectId || undefined) : undefined,
        title: publishForm.title.trim(),
        description: publishForm.description.trim() || undefined,
        tags: publishForm.tags.map((t) => t.trim()).filter(Boolean),
        visibility: publishForm.visibility,
      });

      if (result.status === 'pending') {
        message.success(t('submitted_for_approval'));
      } else if (result.status === 'approved') {
        message.success(t('published_to_feed'));
      } else {
        message.success(t('publication_saved_status', { status: result.status }));
      }

      setIsPublishOpen(false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('failed_publish_dashboard');
      message.error(errorMessage);
    } finally {
      setIsPublishing(false);
    }
  };

  const handlePreviewDashboard = () => {
    if (!activeDashboardId) {
      message.warning('Select a dashboard first.');
      return;
    }
    window.open(sharedDashboardPath, '_blank', 'noopener,noreferrer');
  };

  const handleCopySharedLink = async () => {
    if (!activeDashboardId) {
      message.warning('Select a dashboard first.');
      return;
    }
    try {
      await navigator.clipboard.writeText(sharedDashboardUrl);
      message.success('Dashboard link copied.');
    } catch {
      message.error('Unable to copy link.');
    }
  };

  const openPublishModal = () => {
    if (!activeDashboardId || !activeDashboard) {
      message.warning('Select a dashboard first.');
      return;
    }

    const defaultVisibility: FeedVisibility = !isEnterpriseEdition
      ? 'public'
      : resolvedProjectId
        ? 'project'
        : resolvedOrganizationId
          ? 'organization'
          : 'private';

    setPublishForm({
      title: activeDashboard.name || 'Dashboard',
      description: '',
      tags: [],
      visibility: defaultVisibility,
    });
    setIsPublishOpen(true);
  };

  const filteredDashboards = dashboards.filter((d) => d.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const dashboardNavigator = (
    <div className="dashboard-navigator-dropdown">
      <div className="navigator-search">
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--studio-text-muted)' }} />}
          placeholder="Search dashboards..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          variant="filled"
          className="navigator-search-input"
          allowClear
        />
      </div>
      <div className="navigator-list">
        {filteredDashboards.length === 0 ? (
          <div className="navigator-empty">No dashboards found</div>
        ) : (
          filteredDashboards.map((dash) => (
            <div
              key={dash.id}
              className={`navigator-item ${dash.id === activeDashboardId ? 'active' : ''}`}
              onClick={() => {
                if (editingDashboardId !== dash.id) {
                  setActiveDashboardId(dash.id);
                }
              }}
            >
              <DashboardOutlined className="item-icon" />
              {editingDashboardId === dash.id ? (
                <Input
                  className="navigator-item-input"
                  size="small"
                  autoFocus
                  value={newDashboardName}
                  onChange={(e) => setNewDashboardName(e.target.value)}
                  onBlur={() => handleConfirmRename(dash.id)}
                  onPressEnter={() => handleConfirmRename(dash.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="item-name">{dash.name}</span>
                  <div className="item-actions">
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={(e) => handleOpenRename(e, { id: dash.id, name: dash.name })}
                      className="action-btn"
                    />
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => handleOpenDelete(e, { id: dash.id, name: dash.name })}
                      className="action-btn"
                    />
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
      <div className="navigator-footer">
        <Button type="text" icon={<PlusOutlined />} onClick={() => addDashboard()} className="add-dash-btn">
          New Dashboard
        </Button>
      </div>
    </div>
  );
  const dashboardMenu = {
    selectedKeys: [activeDashboardId || ''],
    items: [
      ...dashboards.map((dash) => ({
        key: dash.id,
        icon: <DashboardOutlined />,
        label: dash.name,
        onClick: () => setActiveDashboardId(dash.id),
      })),
      {
        type: 'divider' as const,
      },
      {
        key: 'add',
        icon: <PlusOutlined />,
        label: t('new_dashboard'),
        onClick: () => addDashboard(),
      },
    ],
  };

  const sampleDashboardMenu = {
    items:
      sampleTemplates.length > 0
        ? sampleTemplates.map((template) => ({
            key: template.id,
            disabled: !!creatingTemplateId,
            label: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 500 }}>{template.name}</span>
                <span style={{ fontSize: 12, opacity: 0.75 }}>{template.category}</span>
              </div>
            ),
            onClick: () => createDashboardFromTemplate(template),
          }))
        : [
            {
              key: 'empty',
              disabled: true,
              label: isLoadingTemplates ? 'Loading templates...' : 'No sample templates found',
            },
          ],
  };

  return (
    <div className="dashboard-studio-toolbar">
      <div className="toolbar-left" style={{ flex: 1 }}>
        <Dropdown dropdownRender={() => dashboardNavigator} trigger={['click']}>
          <div className="dashboard-breadcrumb-selector">
            <div className="breadcrumb-icon-wrapper">
              <ClockCircleOutlined />
            </div>
            <span className="active-dash-name">{activeDashboard?.name || t('dashboard')}</span>
            <DownOutlined className="dropdown-arrow" />
          </div>
        </Dropdown>
      </div>

      <div className="toolbar-right">
        <Space size={16}>
          {isSaving && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--studio-text-muted)',
                fontSize: '13px',
              }}
            >
              <Spin size="small" />
              <span>{t('saving')}</span>
            </div>
          )}
          <AddBlockPopover onSelect={handleSelectBlock}>
            <Button icon={<PlusOutlined />} className="toolbar-btn toolbar-btn-primary">
              Add Block
            </Button>
          </AddBlockPopover>

          <Dropdown menu={sampleDashboardMenu} trigger={['click']}>
            <Button
              className="toolbar-btn"
              icon={<DashboardOutlined />}
              loading={!!creatingTemplateId}
              disabled={isLoadingTemplates && sampleTemplates.length === 0}
            >
              Sample Dashboards
            </Button>
          </Dropdown>

          <Button className="toolbar-btn toolbar-btn-ghost" icon={<SendOutlined />} onClick={openPublishModal}>
            Publish
          </Button>

          <Button className="toolbar-btn toolbar-btn-ghost" icon={<CalendarOutlined />} onClick={openAutoSendModal}>
            Set automation send
          </Button>

          <Button
            className="toolbar-btn toolbar-btn-ghost"
            icon={<UnorderedListOutlined />}
            onClick={openAutomationListModal}
          >
            {t('publish')}
          </Button>

          <Button
            type="text"
            icon={<ExpandOutlined style={{ fontSize: '16px' }} />}
            className="toolbar-btn"
            onClick={() => {
              const studioWrapper = document.querySelector('.studio-wrapper');
              if (!isFullscreen) {
                if (studioWrapper && studioWrapper.requestFullscreen) {
                  studioWrapper.requestFullscreen();
                } else if (studioWrapper && (studioWrapper as any).webkitRequestFullscreen) {
                  (studioWrapper as any).webkitRequestFullscreen();
                } else if (studioWrapper && (studioWrapper as any).msRequestFullscreen) {
                  (studioWrapper as any).msRequestFullscreen();
                }
              } else {
                if (document.exitFullscreen) {
                  document.exitFullscreen();
                } else if ((document as any).webkitExitFullscreen) {
                  (document as any).webkitExitFullscreen();
                } else if ((document as any).msExitFullscreen) {
                  (document as any).msExitFullscreen();
                }
              }
            }}
          >
            {isFullscreen ? t('exit_full_screen') : t('full_screen')}
          </Button>
        </Space>
      </div>

      <Modal
        title={t('publish_dashboard_to_feed')}
        open={isPublishOpen}
        onOk={handlePublish}
        confirmLoading={isPublishing}
        onCancel={() => setIsPublishOpen(false)}
        okText={t('publish')}
        destroyOnClose
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <div style={{ fontSize: '12px', marginBottom: 6, color: 'var(--ant-color-text-secondary)' }}>
              {t('title')}
            </div>
            <Input
              value={publishForm.title}
              onChange={(e) => setPublishForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder={t('dashboard_title_placeholder')}
            />
          </div>
          <div>
            <div style={{ fontSize: '12px', marginBottom: 6, color: 'var(--ant-color-text-secondary)' }}>
              {t('description')}
            </div>
            <Input.TextArea
              rows={3}
              value={publishForm.description}
              onChange={(e) => setPublishForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder={t('brief_summary_placeholder')}
            />
          </div>
          <div>
            <div style={{ fontSize: '12px', marginBottom: 6, color: 'var(--ant-color-text-secondary)' }}>
              {t('tags')}
            </div>
            <Select
              mode="tags"
              style={{ width: '100%' }}
              value={publishForm.tags}
              onChange={(value) => setPublishForm((prev) => ({ ...prev, tags: value }))}
              placeholder={t('add_tags')}
            />
          </div>
          <div>
            <div style={{ fontSize: '12px', marginBottom: 6, color: 'var(--ant-color-text-secondary)' }}>
              {t('visibility')}
            </div>
            <Select
              style={{ width: '100%' }}
              value={publishForm.visibility}
              onChange={(value) => setPublishForm((prev) => ({ ...prev, visibility: value as FeedVisibility }))}
              options={
                isEnterpriseEdition
                  ? [
                      { value: 'private', label: t('private') },
                      { value: 'project', label: t('project'), disabled: !resolvedProjectId },
                      { value: 'organization', label: t('organization'), disabled: !resolvedOrganizationId },
                      { value: 'public', label: t('public') },
                    ]
                  : [
                      { value: 'private', label: t('private') },
                      { value: 'public', label: t('public') },
                    ]
              }
            />
          </div>
        </Space>
      </Modal>

      <Modal
        title="Remove Dashboard"
        open={isDeleteModalOpen}
        onOk={handleConfirmDelete}
        onCancel={() => setIsDeleteModalOpen(false)}
        okButtonProps={{ danger: true }}
        okText="Remove"
        destroyOnClose
      >
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: '10px 0' }}>
          <ExclamationCircleOutlined style={{ fontSize: '22px', color: '#ff4d4f' }} />
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: 8 }}>Are you sure?</div>
            <div style={{ color: 'var(--ant-color-text-secondary)' }}>
              This will permanently delete the dashboard <strong>{dashboardToEdit?.name}</strong> and all its widgets.
              This action cannot be undone.
            </div>
          </div>
        </div>
      </Modal>

      <SchedulePublishModals
        isAutoSendOpen={isAutoSendOpen}
        setIsAutoSendOpen={setIsAutoSendOpen}
        isSavingAutoSend={isSavingAutoSend}
        autoSendForm={autoSendForm}
        setAutoSendForm={setAutoSendForm}
        handleSaveAutoSend={handleSaveAutoSend}
        externalRecipientInput={externalRecipientInput}
        setExternalRecipientInput={setExternalRecipientInput}
        addExternalRecipient={addExternalRecipient}
        isLoadingOrgMembers={isLoadingOrgMembers}
        orgMemberEmails={orgMemberEmails}
        orgMemberLabelMap={orgMemberLabelMap}
        isAutomationListOpen={isAutomationListOpen}
        setIsAutomationListOpen={setIsAutomationListOpen}
        isLoadingScheduledEmails={isLoadingScheduledEmails}
        scheduledEmails={scheduledEmails}
        isDeletingScheduleId={isDeletingScheduleId}
        isTogglingScheduleId={isTogglingScheduleId}
        handleDeleteSchedule={handleDeleteSchedule}
        openEditAutomationModal={openEditAutomationModal}
        handleToggleScheduleEnabled={handleToggleScheduleEnabled}
        isEditAutomationOpen={isEditAutomationOpen}
        setIsEditAutomationOpen={setIsEditAutomationOpen}
        isSavingEditAutomation={isSavingEditAutomation}
        editingAutomationForm={editingAutomationForm}
        setEditingAutomationForm={setEditingAutomationForm}
        handleUpdateSchedule={handleUpdateSchedule}
        sharedDashboardUrl={sharedDashboardUrl}
        handlePreviewDashboard={handlePreviewDashboard}
        handleCopySharedLink={handleCopySharedLink}
      />
    </div>
  );
};
