'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { getChatHref } from '@/utils/appPaths';
import { useTranslations } from 'next-intl';
import { useDashboardStore, type RuntimeFilter, useCanUndo, useCanRedo, useUndo, useRedo } from '../stores/useDashboardStore';
import { useProjectStore } from '@/stores/useProjectStore';
import PublishToFeedModal from '@/components/Feed/PublishToFeedModal';
import { chartService, type DashboardTemplate } from '../services/chartService';
import {
  PlusOutlined,
  RobotOutlined,
  DashboardOutlined,
  ExpandOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  StarOutlined,
  StarFilled,
  CopyOutlined,
  UndoOutlined,
  RedoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  HistoryOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  FolderAddOutlined,
  CaretRightOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Dropdown, Button, Space, Modal, Input, Select, message, Spin, Divider, Tag, Tooltip } from 'antd';
import { TagOutlined } from '@ant-design/icons';
import { useFolderStore } from '../stores/useFolderStore';
import './DashboardTabs.css';
import { AddBlockPopover } from './AddBlockPopover';
import type { DashboardFilter } from '@/types/dashboard';
import type { LayoutPreset } from './LayoutPresetsMenu';
import { VersionHistoryDrawer } from './VersionHistoryDrawer';
import { SchedulePublishModals } from './SchedulePublishModals';
import { DashboardShareMenu } from './DashboardShareMenu';
import { useAutomationManager } from '../hooks/useAutomationManager';
import { exportDashboardCanvas } from '../services/exportDashboardService';
import { maxLayoutY } from '../utils/layoutSanitize';
import { formatApiValidationError } from '@/utils/validationErrorMessage';
import { getDashboardApiErrorMessage, isPublishOwnerError } from '../utils/dashboardApiErrors';
import type { CollabUser } from '../utils/collaborationTypes';
import {
  buildDashboardFeedPreviewMetadata,
  computeStudioSnapshotFingerprint,
} from '@/app/(dashboard)/feed/utils/dashboardFeedBridge';
import { buildDashboardSnapshotPayload } from '@/app/(dashboard)/feed/utils/buildFeedSnapshotPayload';
import type { PublishAssetResponse } from '@/services/socialFeedService';
import type { DashboardPageItem } from './DashboardPageTabs';

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

type DashboardTabsProps = {
  onAddBlock?: (type: string) => void;
  onAddFilterPreset?: (filter: Partial<DashboardFilter>) => void;
  onApplyLayoutPreset?: (preset: LayoutPreset) => void;
  filtersPanelOpen?: boolean;
  onOpenFilterPanel?: () => void;
  onOpenFilterManager?: () => void;
  activePageId?: string | null;
  pages?: DashboardPageItem[];
  runtimeFilters?: RuntimeFilter[];
  /** EE live collaboration — show compact indicator only when other editors are present. */
  collabConnected?: boolean;
  collabPeerCount?: number;
  collabActiveUsers?: CollabUser[];
};

export const DashboardTabs: React.FC<DashboardTabsProps> = ({
  onAddBlock,
  onAddFilterPreset,
  onApplyLayoutPreset,
  filtersPanelOpen = false,
  onOpenFilterPanel,
  onOpenFilterManager,
  activePageId,
  pages = [],
  runtimeFilters = [],
  collabConnected = false,
  collabPeerCount = 0,
  collabActiveUsers = [],
}) => {
  const t = useTranslations('dashboard_tabs');
  const td = useTranslations('dashboards');
  const tp = useTranslations('dashboards_page');
  const {
    dashboards,
    activeDashboardId,
    layout,
    widgets,
    globalFiltersConfig,
    pageFiltersConfig,
    isSaving,
    isFullscreen,
    studioMode,
    setStudioMode,
    setActiveDashboardId,
    addDashboard,
    fetchDashboards,
    addWidget: addWidgetToStore,
  } = useDashboardStore();
  const { currentProject, currentProjectId } = useProjectStore();

  const activeDashboard = dashboards.find((d) => d.id === activeDashboardId);
  const sharedDashboardPath = buildSharedDashboardPath(activeDashboardId);
  const sharedDashboardUrl = buildSharedDashboardUrl(activeDashboardId);

  const buildShareUrlWithContext = useCallback(() => {
    const base = buildSharedDashboardUrl(activeDashboardId);
    if (typeof window === 'undefined') return base;
    const url = new URL(base, window.location.origin);
    if (activePageId) url.searchParams.set('page', activePageId);
    if (runtimeFilters.length) {
      url.searchParams.set('filters', encodeURIComponent(JSON.stringify(runtimeFilters)));
    }
    return url.pathname + url.search;
  }, [activeDashboardId, activePageId, runtimeFilters]);

  const resolvedOrganizationId =
    currentProject?.organization_id || (currentProject as { organizationId?: string } | null)?.organizationId;
  const resolvedProjectId =
    currentProjectId != null
      ? String(currentProjectId)
      : currentProject?.id != null
        ? String(currentProject.id)
        : undefined;

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

  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [sampleTemplates, setSampleTemplates] = useState<DashboardTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [editingDashboardId, setEditingDashboardId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [dashboardToEdit, setDashboardToEdit] = useState<{ id: string; name: string } | null>(null);
  const [newDashboardName, setNewDashboardName] = useState('');
  const [editTagsDashboardId, setEditTagsDashboardId] = useState<string | null>(null);
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // Folder state
  const { folders, assignments, collapsedFolderIds, createFolder, renameFolder, deleteFolder, toggleCollapse, assignDashboard } = useFolderStore();
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');

  const { updateDashboardName, updateDashboardMeta, removeDashboard, duplicateDashboard, starredDashboardIds, toggleStarDashboard, updateDashboardTags } = useDashboardStore();

  const publishPreviewMetadata = useMemo(() => {
    if (!activeDashboardId || !activeDashboard) return undefined;
    return buildDashboardFeedPreviewMetadata({
      dashboardId: activeDashboardId,
      title: activeDashboard.name,
      description: activeDashboard.description,
      widgets,
      layout,
      globalFilters: globalFiltersConfig,
      pageFilters: pageFiltersConfig,
      pages,
      defaultPageId: activePageId,
    });
  }, [
    activeDashboardId,
    activeDashboard,
    widgets,
    layout,
    globalFiltersConfig,
    pageFiltersConfig,
    pages,
    activePageId,
  ]);

  const publishSnapshotPayload = useMemo(() => {
    if (!activeDashboardId || !activeDashboard) return undefined;
    return buildDashboardSnapshotPayload({
      dashboardId: activeDashboardId,
      title: activeDashboard.name,
      description: activeDashboard.description,
      widgets,
      layout,
      globalFilters: globalFiltersConfig,
      pageFilters: pageFiltersConfig,
      pages: pages.map((p) => ({ id: p.id, name: p.name })),
      runtimeFilters,
    });
  }, [
    activeDashboardId,
    activeDashboard,
    widgets,
    layout,
    globalFiltersConfig,
    pageFiltersConfig,
    pages,
    runtimeFilters,
  ]);

  const handlePublishSuccess = useCallback(
    async (result: PublishAssetResponse) => {
      if (!activeDashboardId || !result.publication_id) {
        setIsPublishOpen(false);
        return;
      }
      try {
        const fingerprint = computeStudioSnapshotFingerprint({
          widgets,
          layout,
          globalFilters: globalFiltersConfig,
          pageFilters: pageFiltersConfig,
          pages: pages.map((p) => ({ id: p.id, name: p.name })),
        });
        await updateDashboardMeta(activeDashboardId, {
          config: {
            ...(((activeDashboard as { config?: Record<string, unknown> })?.config) || {}),
            feed_post_id: result.publication_id,
            feed_snapshot_version: result.snapshot_version ?? 1,
            feed_snapshot_fingerprint: fingerprint,
          },
        });
        message.success(t('published_to_feed'));
      } catch (err) {
        message.error(formatApiValidationError(err));
      } finally {
        setIsPublishOpen(false);
      }
    },
    [activeDashboard, activeDashboardId, updateDashboardMeta, t],
  );

  // Undo / redo
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const undo = useUndo();
  const redo = useRedo();

  // Canvas zoom
  const canvasZoom = useDashboardStore((s) => s.canvasZoom);
  const setCanvasZoom = useDashboardStore((s) => s.setCanvasZoom);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const ZOOM_STEPS = [25, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200];
  const zoomIn  = () => { const next = ZOOM_STEPS.find((z) => z > canvasZoom); if (next) setCanvasZoom(next); };
  const zoomOut = () => { const next = [...ZOOM_STEPS].reverse().find((z) => z < canvasZoom); if (next) setCanvasZoom(next); };

  const isEditMode = studioMode === 'edit' && !isFullscreen;
  const [titleDraft, setTitleDraft] = useState('');
  const [subtitleDraft, setSubtitleDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingSubtitle, setEditingSubtitle] = useState(false);

  useEffect(() => {
    setTitleDraft(activeDashboard?.name || '');
    setSubtitleDraft(activeDashboard?.description || '');
    setEditingTitle(false);
    setEditingSubtitle(false);
  }, [activeDashboard?.id, activeDashboard?.name, activeDashboard?.description]);

  const handleOpenRename = (e: React.MouseEvent, dash: { id: string; name: string }) => {
    e.stopPropagation();
    setEditingDashboardId(dash.id);
    setNewDashboardName(dash.name);
  };

  const handleOpenDelete = (e: React.MouseEvent, dash: { id: string; name: string }) => {
    e.stopPropagation();
    if (dashboards.length <= 1) {
      message.warning(t('cannot_delete_last_dashboard'));
      return;
    }
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
    message.success(t('dashboard_renamed'));
  };

  const handleConfirmDelete = async () => {
    if (!dashboardToEdit) return;
    try {
      await removeDashboard(dashboardToEdit.id);
      setIsDeleteModalOpen(false);
      setDashboardToEdit(null);
      message.success(t('dashboard_removed'));
    } catch (err) {
      const detail = getDashboardApiErrorMessage(err, t('failed_remove_dashboard'));
      message.error(isPublishOwnerError(err) ? t('published_owner_only') : detail);
    }
  };

  const saveTitle = async () => {
    if (!activeDashboardId) return;
    const name = titleDraft.trim();
    setEditingTitle(false);
    if (!name || name === activeDashboard?.name) return;
    try {
      await updateDashboardMeta(activeDashboardId, { name });
      message.success(t('dashboard_renamed'));
    } catch (err) {
      message.error(
        isPublishOwnerError(err) ? t('published_owner_only') : t('failed_rename_dashboard')
      );
      setTitleDraft(activeDashboard?.name || '');
    }
  };

  const saveSubtitle = async () => {
    if (!activeDashboardId) return;
    const description = subtitleDraft.trim();
    setEditingSubtitle(false);
    if (description === (activeDashboard?.description || '')) return;
    try {
      await updateDashboardMeta(activeDashboardId, { description });
    } catch (err) {
      message.error(
        isPublishOwnerError(err) ? t('published_owner_only') : t('failed_update_subtitle')
      );
      setSubtitleDraft(activeDashboard?.description || '');
    }
  };

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
          message.error(t('templates_load_failed'));
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
  }, [t]);

  const createDashboardFromTemplate = async (template: DashboardTemplate) => {
    if (isEnterpriseEdition && !resolvedProjectId) {
      message.warning(t('select_project_first'));
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
      message.success(t('template_created', { title }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('template_create_failed');
      message.error(errorMessage);
    } finally {
      setCreatingTemplateId(null);
    }
  };

  const handleSelectBlock = (type: string) => {
    if (onAddBlock) {
      onAddBlock(type);
      return;
    }
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
      y: maxLayoutY(layout),
      w: 4,
      h: 5,
    };

    addWidgetToStore(newWidget, layoutItem);
  };

  const handlePreviewDashboard = () => {
    if (!activeDashboardId) {
      message.warning(t('select_dashboard_first'));
      return;
    }
    const previewPath = buildShareUrlWithContext();
    window.open(previewPath, '_blank', 'noopener,noreferrer');
  };

  const handleCopySharedLink = async () => {
    if (!activeDashboardId) {
      message.warning(t('select_dashboard_first'));
      return;
    }
    try {
      await navigator.clipboard.writeText(buildShareUrlWithContext());
      message.success(td('share_link_copied'));
    } catch {
      message.error(t('unable_copy_link'));
    }
  };

  const openPublishModal = () => {
    if (!activeDashboardId || !activeDashboard) {
      message.warning(t('select_dashboard_first'));
      return;
    }
    setIsPublishOpen(true);
  };

  const handleDashboardExport = async (format: string) => {
    if (!activeDashboardId) {
      message.warning(t('select_dashboard_first'));
      return;
    }
    try {
      await exportDashboardCanvas(format === 'pdf' ? 'pdf' : 'png', {
        filename: activeDashboard?.name || 'dashboard',
      });
      message.success(format === 'pdf' ? td('toast_export_pdf_ok') : td('toast_export_png_ok'));
    } catch (error) {
      const detail = error instanceof Error ? error.message : td('toast_export_failed');
      message.error(detail);
    }
  };

  const toggleFullscreen = () => {
    const studioWrapper = document.querySelector('.studio-wrapper');
    if (!isFullscreen) {
      if (studioWrapper && studioWrapper.requestFullscreen) {
        studioWrapper.requestFullscreen();
      } else if (studioWrapper && (studioWrapper as any).webkitRequestFullscreen) {
        (studioWrapper as any).webkitRequestFullscreen();
      } else if (studioWrapper && (studioWrapper as any).msRequestFullscreen) {
        (studioWrapper as any).msRequestFullscreen();
      }
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen();
    } else if ((document as any).msExitFullscreen) {
      (document as any).msExitFullscreen();
    }
  };

  const allFiltered = dashboards.filter((d) => {
    const matchesSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTag = !activeTagFilter || (d.tags || []).includes(activeTagFilter);
    return matchesSearch && matchesTag;
  });
  // Starred first, then alphabetical within each group
  const filteredDashboards = [
    ...allFiltered.filter((d) => starredDashboardIds.has(d.id)),
    ...allFiltered.filter((d) => !starredDashboardIds.has(d.id)),
  ];
  // Collect all tags across all dashboards for the filter chips
  const allTags = Array.from(new Set(dashboards.flatMap((d) => d.tags || []))).sort();

  /** Render a single dashboard row in the navigator (shared by flat + folder views) */
  const renderDashItem = (dash: { id: string; name: string; tags?: string[] }) => (
    <div
      key={dash.id}
      className={`navigator-item ${dash.id === activeDashboardId ? 'active' : ''}`}
      onClick={() => {
        if (editingDashboardId !== dash.id) setActiveDashboardId(dash.id);
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
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="item-name">{dash.name}</span>
            {(dash.tags || []).length > 0 && (
              <div className="item-tag-chips">
                {(dash.tags || []).map((tag) => (
                  <Tag
                    key={tag}
                    style={{ fontSize: 10, borderRadius: 8, padding: '0 5px', lineHeight: '16px', marginRight: 2 }}
                    onClick={(e) => { e.stopPropagation(); setActiveTagFilter(tag); }}
                  >
                    {tag}
                  </Tag>
                ))}
              </div>
            )}
          </div>
          <div className="item-actions">
            <Button
              type="text" size="small"
              icon={starredDashboardIds.has(dash.id) ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
              onClick={(e) => { e.stopPropagation(); toggleStarDashboard(dash.id); }}
              className="action-btn" title="Star / Unstar"
            />
            <Button
              type="text" size="small" icon={<TagOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                setEditTagsDashboardId(dash.id);
                setPendingTags(dash.tags || []);
                setTagInput('');
              }}
              className="action-btn" title="Edit tags"
            />
            {/* Move to folder */}
            {folders.length > 0 && (
              <Dropdown
                trigger={['click']}
                menu={{
                  onClick: ({ key }) => {
                    assignDashboard(dash.id, key === '__root' ? null : key);
                  },
                  items: [
                    { key: '__root', label: '— No folder —' },
                    ...folders.map((f) => ({ key: f.id, label: f.name, icon: <FolderOutlined /> })),
                  ],
                  selectedKeys: assignments[dash.id] ? [assignments[dash.id]] : ['__root'],
                }}
              >
                <Button
                  type="text" size="small" icon={<FolderOutlined />}
                  className="action-btn" title="Move to folder"
                  onClick={(e) => e.stopPropagation()}
                />
              </Dropdown>
            )}
            <Button
              type="text" size="small" icon={<EditOutlined />}
              onClick={(e) => handleOpenRename(e, { id: dash.id, name: dash.name })}
              className="action-btn"
            />
            <Button
              type="text" size="small" icon={<CopyOutlined />}
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await duplicateDashboard(dash.id);
                  message.success('Dashboard duplicated');
                } catch {
                  message.error('Failed to duplicate dashboard');
                }
              }}
              className="action-btn" title="Duplicate"
            />
            <Button
              type="text" size="small" danger icon={<DeleteOutlined />}
              onClick={(e) => handleOpenDelete(e, { id: dash.id, name: dash.name })}
              className="action-btn"
            />
          </div>
        </>
      )}
    </div>
  );

  const dashboardNavigator = (
    <div className="dashboard-navigator-dropdown">
      <div className="navigator-new-dashboard-row">
        <Button
          type="default"
          block
          size="small"
          icon={<PlusOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            void addDashboard().catch((err) => message.error(formatApiValidationError(err)));
          }}
        >
          {t('new_dashboard')}
        </Button>
        {isEnterpriseEdition ? (
          <Link href={getChatHref({ mode: 'dashboard' })} className="navigator-new-ai-link" onClick={(e) => e.stopPropagation()}>
            <Button type="default" block size="small" icon={<RobotOutlined />}>
              {t('new_dashboard_with_ai')}
            </Button>
          </Link>
        ) : null}
        <Tooltip title="Create a new folder to organise dashboards">
          <Button
            type="text"
            size="small"
            icon={<FolderAddOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              const id = createFolder('New Folder');
              setEditingFolderId(id);
              setNewFolderName('New Folder');
            }}
            title="New folder"
          />
        </Tooltip>
      </div>
      <div className="navigator-search">
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--studio-text-muted)' }} />}
          placeholder={t('search_dashboards')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          variant="filled"
          className="navigator-search-input"
          allowClear
        />
        {allTags.length > 0 && (
          <div className="navigator-tag-filters">
            {allTags.map((tag) => (
              <Tag
                key={tag}
                className={`navigator-tag-chip${activeTagFilter === tag ? ' active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setActiveTagFilter(activeTagFilter === tag ? null : tag); }}
                style={{ cursor: 'pointer', borderRadius: 10 }}
              >
                {tag}
              </Tag>
            ))}
          </div>
        )}
      </div>
      <div className="navigator-list">
        {/* Folder hierarchy — only show when there are folders or search is not active */}
        {folders.length > 0 && !searchTerm && !activeTagFilter && (
          <>
            {folders.map((folder) => {
              const folderDashes = filteredDashboards.filter((d) => assignments[d.id] === folder.id);
              const isCollapsed = collapsedFolderIds.has(folder.id);
              return (
                <div key={folder.id} className="navigator-folder">
                  {/* Folder header */}
                  <div
                    className="navigator-folder-header"
                    onClick={(e) => { e.stopPropagation(); toggleCollapse(folder.id); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px', cursor: 'pointer', borderRadius: 6, userSelect: 'none' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ant-color-fill-quaternary)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <CaretRightOutlined style={{ fontSize: 10, color: 'var(--ant-color-text-description)', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 0.15s' }} />
                    {isCollapsed ? <FolderOutlined style={{ color: 'var(--ant-color-primary)', fontSize: 13 }} /> : <FolderOpenOutlined style={{ color: 'var(--ant-color-primary)', fontSize: 13 }} />}
                    {editingFolderId === folder.id ? (
                      <Input
                        size="small"
                        autoFocus
                        value={newFolderName}
                        style={{ flex: 1, fontSize: 12 }}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onBlur={() => { if (newFolderName.trim()) renameFolder(folder.id, newFolderName); setEditingFolderId(null); }}
                        onPressEnter={() => { if (newFolderName.trim()) renameFolder(folder.id, newFolderName); setEditingFolderId(null); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {folder.name}
                        <span style={{ marginLeft: 4, color: 'var(--ant-color-text-quaternary)', fontSize: 10 }}>({folderDashes.length})</span>
                      </span>
                    )}
                    <div className="item-actions" style={{ display: 'flex', gap: 1 }} onClick={(e) => e.stopPropagation()}>
                      <Tooltip title="Rename folder">
                        <Button type="text" size="small" icon={<EditOutlined />} className="action-btn"
                          onClick={(e) => { e.stopPropagation(); setEditingFolderId(folder.id); setNewFolderName(folder.name); }}
                        />
                      </Tooltip>
                      <Tooltip title="Delete folder (dashboards become unassigned)">
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} className="action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            Modal.confirm({
                              title: `Delete folder "${folder.name}"?`,
                              content: 'Dashboards in this folder will become unassigned.',
                              okText: 'Delete',
                              okType: 'danger',
                              onOk: () => deleteFolder(folder.id),
                            });
                          }}
                        />
                      </Tooltip>
                    </div>
                  </div>
                  {/* Folder contents */}
                  {!isCollapsed && (
                    <div style={{ paddingLeft: 18 }}>
                      {folderDashes.length === 0 && (
                        <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--ant-color-text-quaternary)' }}>Empty folder</div>
                      )}
                      {folderDashes.map((dash) => renderDashItem(dash))}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Unassigned dashboards */}
            {filteredDashboards.filter((d) => !assignments[d.id]).length > 0 && folders.length > 0 && (
              <div style={{ padding: '4px 8px 2px', fontSize: 10, color: 'var(--ant-color-text-quaternary)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Unassigned
              </div>
            )}
          </>
        )}

        {/* Flat list (when no folders, or when searching/filtering) */}
        {(folders.length === 0 || searchTerm || activeTagFilter) && (
          filteredDashboards.length === 0 ? (
            <div className="navigator-empty">{t('no_dashboards_found')}</div>
          ) : (
            filteredDashboards.map((dash) => renderDashItem(dash))
          )
        )}

        {/* Unassigned dashboards when folders exist and no filter active */}
        {folders.length > 0 && !searchTerm && !activeTagFilter && (
          filteredDashboards
            .filter((d) => !assignments[d.id])
            .map((dash) => renderDashItem(dash))
        )}
      </div>

      {(isLoadingTemplates || sampleTemplates.length > 0) && (
        <>
          <Divider className="navigator-divider" />
          <div className="navigator-samples">
            <div className="navigator-samples-title">{t('sample_dashboards')}</div>
            {isLoadingTemplates ? (
              <div className="navigator-samples-loading">
                <Spin size="small" />
                <span>{t('loading_templates')}</span>
              </div>
            ) : (
              sampleTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="navigator-sample-item"
                  disabled={!!creatingTemplateId}
                  onClick={() => createDashboardFromTemplate(template)}
                >
                  <span className="navigator-sample-name">{template.name}</span>
                  <span className="navigator-sample-category">{template.category}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="dashboard-studio-toolbar">
      <div className="toolbar-left">
        <Dropdown popupRender={() => dashboardNavigator} trigger={['click']}>
          <Button type="text" className="toolbar-dash-switch" icon={<DashboardOutlined />} aria-label={t('dashboard')} />
        </Dropdown>

        <div className="toolbar-title-block">
          {isEditMode && editingTitle ? (
            <Input
              className="toolbar-title-input"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void saveTitle()}
              onPressEnter={() => void saveTitle()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setTitleDraft(activeDashboard?.name || '');
                  setEditingTitle(false);
                }
              }}
              placeholder={t('dashboard_title_placeholder')}
            />
          ) : isEditMode ? (
            <button
              type="button"
              className="toolbar-title-display"
              onClick={() => setEditingTitle(true)}
              title={t('click_edit_title')}
            >
              {activeDashboard?.name || t('dashboard')}
            </button>
          ) : (
            <span className="toolbar-title-display toolbar-title-readonly">
              {activeDashboard?.name || t('dashboard')}
            </span>
          )}

          {isEditMode && editingSubtitle ? (
            <Input
              className="toolbar-subtitle-input"
              value={subtitleDraft}
              autoFocus
              onChange={(e) => setSubtitleDraft(e.target.value)}
              onBlur={() => void saveSubtitle()}
              onPressEnter={() => void saveSubtitle()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSubtitleDraft(activeDashboard?.description || '');
                  setEditingSubtitle(false);
                }
              }}
              placeholder={t('subtitle_placeholder')}
            />
          ) : isEditMode ? (
            <button
              type="button"
              className={`toolbar-subtitle-display ${subtitleDraft ? '' : 'empty'}`}
              onClick={() => setEditingSubtitle(true)}
              title={t('click_edit_subtitle')}
            >
              {subtitleDraft || t('subtitle_placeholder')}
            </button>
          ) : subtitleDraft ? (
            <span className="toolbar-subtitle-display">{subtitleDraft}</span>
          ) : null}
        </div>
      </div>

      <div className="toolbar-right">
        <Space size={8} align="center" className="toolbar-actions">
          {isSaving && (
            <div className="toolbar-saving">
              <Spin size="small" />
              <span>{t('saving')}</span>
            </div>
          )}

          {isEditMode && collabConnected && collabPeerCount > 0 && (
            <Tooltip
              title={`${tp('live_sync')} · ${collabPeerCount + 1} ${tp('editors_online')}`}
            >
              <span
                className="toolbar-collab-indicator"
                role="status"
                aria-label={`${tp('live_sync')} · ${collabPeerCount + 1} ${tp('editors_online')}`}
              >
                <span className="toolbar-collab-avatars">
                  {collabActiveUsers.slice(0, 4).map((u) => {
                    const uid = u.user_id || u.id || u.email || 'user';
                    const label = u.username || u.name || u.email || '?';
                    return (
                      <span
                        key={String(uid)}
                        className="toolbar-collab-avatar"
                        style={{ background: u.color || 'var(--ant-color-primary)' }}
                        title={label}
                      >
                        {label.charAt(0).toUpperCase()}
                      </span>
                    );
                  })}
                </span>
                <TeamOutlined />
                <span className="toolbar-collab-count">{collabPeerCount + 1}</span>
              </span>
            </Tooltip>
          )}

          {isEditMode && (
            <div className="toolbar-history-btns">
              <button
                type="button"
                className="toolbar-history-btn"
                disabled={!canUndo}
                onClick={() => undo?.()}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
              >
                <UndoOutlined />
              </button>
              <button
                type="button"
                className="toolbar-history-btn"
                disabled={!canRedo}
                onClick={() => redo?.()}
                title="Redo (Ctrl+Y)"
                aria-label="Redo"
              >
                <RedoOutlined />
              </button>
            </div>
          )}

          {/* Version history */}
          {isEditMode && (
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => setVersionHistoryOpen(true)}
              title="Version history"
              aria-label="Version history"
            >
              <HistoryOutlined />
            </button>
          )}

          {/* Zoom control */}
          <div className="toolbar-zoom-control">
            <button
              type="button"
              className="toolbar-zoom-btn"
              onClick={zoomOut}
              disabled={canvasZoom <= 25}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOutOutlined />
            </button>
            <button
              type="button"
              className="toolbar-zoom-label"
              onClick={() => setCanvasZoom(100)}
              title="Reset zoom to 100%"
            >
              {canvasZoom}%
            </button>
            <button
              type="button"
              className="toolbar-zoom-btn"
              onClick={zoomIn}
              disabled={canvasZoom >= 200}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomInOutlined />
            </button>
          </div>

          <button
            type="button"
            className={`toolbar-mode-toggle ${isEditMode ? 'is-editing' : 'is-viewing'}`}
            onClick={() => setStudioMode(isEditMode ? 'view' : 'edit')}
            title={isEditMode ? t('switch_to_view') : t('switch_to_edit')}
            aria-pressed={isEditMode}
          >
            {isEditMode ? <EditOutlined /> : <EyeOutlined />}
            <span>{isEditMode ? t('mode_editing') : t('mode_viewing')}</span>
          </button>

          {isEditMode && (
            <AddBlockPopover
              onSelect={handleSelectBlock}
              onAddFilterPreset={onAddFilterPreset}
              onApplyLayoutPreset={onApplyLayoutPreset}
              filtersPanelOpen={filtersPanelOpen}
              onOpenFilterPanel={onOpenFilterPanel}
              onOpenFilterManager={onOpenFilterManager}
            >
              <Button icon={<PlusOutlined />} className="toolbar-btn toolbar-btn-primary">
                {t('add')}
              </Button>
            </AddBlockPopover>
          )}

          <DashboardShareMenu
            dashboardId={activeDashboardId}
            dashboardName={activeDashboard?.name}
            onPreview={handlePreviewDashboard}
            onExport={(format) => void handleDashboardExport(format)}
            buildShareUrl={buildShareUrlWithContext}
            activePageId={activePageId}
            runtimeFilters={runtimeFilters}
            isEditMode={isEditMode}
            isEnterprise={isEnterpriseEdition}
            onPublish={openPublishModal}
            onScheduleDelivery={openAutoSendModal}
            onManageSchedules={openAutomationListModal}
            isPublic={Boolean((activeDashboard as { config?: { is_public?: boolean } })?.config?.is_public)}
            onPublicAccessChange={(next) => {
              if (!activeDashboardId) return;
              void updateDashboardMeta(activeDashboardId, {
                config: {
                  ...(((activeDashboard as { config?: Record<string, unknown> })?.config) || {}),
                  is_public: next,
                },
              });
            }}
          />

          <Button
            type="text"
            icon={<ExpandOutlined />}
            className="toolbar-btn toolbar-btn-icon"
            onClick={toggleFullscreen}
            title={isFullscreen ? t('exit_full_screen') : t('full_screen')}
            aria-label={isFullscreen ? t('exit_full_screen') : t('full_screen')}
          />
        </Space>
      </div>

      <PublishToFeedModal
        open={isPublishOpen}
        assetType="dashboard"
        assetId={activeDashboardId || undefined}
        defaultTitle={activeDashboard?.name || t('dashboard')}
        defaultDescription={activeDashboard?.description || ''}
        previewMetadata={publishPreviewMetadata}
        snapshotPayload={publishSnapshotPayload}
        renderMode="snapshot"
        organizationId={resolvedOrganizationId || undefined}
        projectId={resolvedProjectId || undefined}
        modalTitle={t('publish_dashboard_to_feed')}
        onCancel={() => setIsPublishOpen(false)}
        onSuccess={handlePublishSuccess}
      />

      <Modal
        title={t('remove_dashboard_title')}
        open={isDeleteModalOpen}
        onOk={handleConfirmDelete}
        onCancel={() => setIsDeleteModalOpen(false)}
        okButtonProps={{ danger: true }}
        okText={t('remove')}
        destroyOnHidden
      >
        <div className="remove-dashboard-body">
          <ExclamationCircleOutlined className="remove-dashboard-icon" />
          <div>
            <div className="remove-dashboard-heading">{t('remove_dashboard_confirm_title')}</div>
            <div className="remove-dashboard-text">
              {t('remove_dashboard_confirm_body', { name: dashboardToEdit?.name ?? '' })}
            </div>
          </div>
        </div>
      </Modal>

      {/* Dashboard tag editor modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <TagOutlined />
            <span>Edit Tags</span>
          </div>
        }
        open={!!editTagsDashboardId}
        onCancel={() => setEditTagsDashboardId(null)}
        onOk={async () => {
          if (editTagsDashboardId) {
            await updateDashboardTags(editTagsDashboardId, pendingTags);
          }
          setEditTagsDashboardId(null);
        }}
        okText="Save"
        width={420}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              placeholder="Type a tag and press Enter"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onPressEnter={() => {
                const t = tagInput.trim().toLowerCase();
                if (t && !pendingTags.includes(t)) {
                  setPendingTags([...pendingTags, t]);
                }
                setTagInput('');
              }}
            />
            <Button
              onClick={() => {
                const t = tagInput.trim().toLowerCase();
                if (t && !pendingTags.includes(t)) {
                  setPendingTags([...pendingTags, t]);
                }
                setTagInput('');
              }}
            >
              Add
            </Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 32 }}>
            {pendingTags.length === 0 && (
              <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 13 }}>No tags yet</span>
            )}
            {pendingTags.map((tag) => (
              <Tag
                key={tag}
                closable
                onClose={() => setPendingTags(pendingTags.filter((t) => t !== tag))}
                style={{ borderRadius: 12, fontSize: 13 }}
              >
                {tag}
              </Tag>
            ))}
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

      <VersionHistoryDrawer
        open={versionHistoryOpen}
        onClose={() => setVersionHistoryOpen(false)}
      />
    </div>
  );
};
