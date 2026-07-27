'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { getChatHref } from '@/utils/appPaths';
import { useTranslations } from 'next-intl';
import { useDashboardStore, type RuntimeFilter, useCanUndo, useCanRedo, useUndo, useRedo } from '../stores/useDashboardStore';
import { useProjectStore } from '@/stores/useProjectStore';
import PublishToFeedModal from '@/components/Feed/PublishToFeedModal';
import { buildDashboardAutoDescription } from '@/components/Feed/chatFeedDraft';
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
  SyncOutlined,
  CompassOutlined,
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
import { OverflowMenuButton } from './OverflowMenuButton';
import { DashboardCollabCommentsPanel } from './DashboardCollabCommentsPanel';
import { useAutomationManager } from '../hooks/useAutomationManager';
import { exportDashboardCanvas, printDashboardOnly } from '../services/exportDashboardService';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';
import { shouldApplyWatermark } from '@/utils/watermark';
import { maxLayoutY } from '../utils/layoutSanitize';
import { formatApiValidationError } from '@/utils/validationErrorMessage';
import { getDashboardApiErrorMessage, isPublishOwnerError } from '../utils/dashboardApiErrors';
import type { CollabUser } from '../utils/collaborationTypes';
import {
  buildDashboardFeedPreviewMetadata,
  computeStudioSnapshotFingerprint,
  feedPostUrl,
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
  /** Live comments — toolbar trigger (not fixed on canvas). */
  collabCommentsOpen?: boolean;
  onCollabCommentsOpenChange?: (open: boolean) => void;
  collabComments?: import('../utils/collaborationTypes').CollabComment[];
  onCollabAddComment?: (text: string, widgetId?: string | null) => void;
  selectedWidgetId?: string | null;
  /** Feed snapshot — when set, shows an icon button next to + Add instead of a banner. */
  feedPostId?: string | null;
  snapshotOutdated?: boolean;
  snapshotVersion?: number;
  onUpdateSnapshot?: () => void;
  updatingSnapshot?: boolean;
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
  collabCommentsOpen = false,
  onCollabCommentsOpenChange,
  collabComments = [],
  onCollabAddComment,
  selectedWidgetId = null,
  feedPostId,
  snapshotOutdated = false,
  snapshotVersion,
  onUpdateSnapshot,
  updatingSnapshot = false,
}) => {
  const t = useTranslations('dashboard_tabs');
  const td = useTranslations('dashboards');
  const tp = useTranslations('dashboards_page');
  const {
    dashboards,
    activeDashboardId,
    isLoadingDashboards,
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
  const { planType } = useSubscriptionStore();
  const exportBranding = shouldApplyWatermark(planType);

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

  // Folder state — server-backed collections (same SSOT as DashboardsSection)
  const {
    folders,
    assignments,
    collapsedFolderIds,
    hydrate: hydrateFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleCollapse,
    assignDashboard,
  } = useFolderStore();
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');

  useEffect(() => {
    void hydrateFolders(currentProjectId);
  }, [hydrateFolders, currentProjectId]);

  const { updateDashboardName, updateDashboardMeta, removeDashboard, duplicateDashboard, starredDashboardIds, toggleStarDashboard, updateDashboardTags } = useDashboardStore();

  const publishAutoDescription = useMemo(
    () => buildDashboardAutoDescription(widgets.map((w) => w.title)),
    [widgets],
  );

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
      colorPalette: activeDashboard.config?.default_color_palette as string | undefined,
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
    const title = titleDraft.trim() || activeDashboard?.name || 'Dashboard';
    const subtitle = subtitleDraft.trim() || undefined;
    const isPdf = format === 'pdf';
    try {
      await exportDashboardCanvas(isPdf ? 'pdf' : 'png', {
        filename: title,
        title,
        subtitle,
        branding: exportBranding,
        // Always respect the user's active light/dark theme
        matchTheme: true,
      });
      message.success(isPdf ? td('toast_export_pdf_ok') : td('toast_export_png_ok'));
    } catch (error) {
      const detail = error instanceof Error ? error.message : td('toast_export_failed');
      message.error(detail);
    }
  };

  const handleDashboardPrint = () => {
    void printDashboardOnly({
      title: titleDraft.trim() || activeDashboard?.name || 'Dashboard',
      subtitle: subtitleDraft.trim() || undefined,
      branding: exportBranding,
      matchTheme: true,
    });
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
      role="button"
      tabIndex={0}
      aria-current={dash.id === activeDashboardId ? 'page' : undefined}
      className={`group flex items-center gap-3 px-4 py-2.5 cursor-pointer text-left transition-colors ${
        dash.id === activeDashboardId
          ? 'bg-brand-subtle text-brand font-semibold'
          : 'text-text-secondary hover:bg-brand-subtle hover:text-brand'
      }`}
      onClick={() => {
        if (editingDashboardId !== dash.id) setActiveDashboardId(dash.id);
      }}
      onKeyDown={(e) => {
        if (editingDashboardId === dash.id) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        setActiveDashboardId(dash.id);
      }}
    >
      <DashboardOutlined className={`shrink-0 text-base ${dash.id === activeDashboardId ? 'text-brand' : 'text-text-tertiary'}`} />
      {editingDashboardId === dash.id ? (
        <Input
          size="small"
          autoFocus
          className="flex-1 h-7 text-[13px] rounded"
          value={newDashboardName}
          onChange={(e) => setNewDashboardName(e.target.value)}
          onBlur={() => handleConfirmRename(dash.id)}
          onPressEnter={() => handleConfirmRename(dash.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <span className="block text-sm truncate" title={dash.name}>{dash.name}</span>
            {(dash.tags || []).length > 0 && (
              <div className="flex flex-wrap gap-0.5 mt-0.5">
                {(dash.tags || []).map((tag) => (
                  <Tag
                    key={tag}
                    className="!text-[10px] !rounded-md !px-1.5 !leading-4 !mr-0"
                    onClick={(e) => { e.stopPropagation(); setActiveTagFilter(tag); }}
                  >
                    {tag}
                  </Tag>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              type="text" size="small"
              icon={starredDashboardIds.has(dash.id) ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
              onClick={(e) => { e.stopPropagation(); toggleStarDashboard(dash.id); }}
              className="text-text-tertiary hover:text-brand" title={t('star_toggle')}
              aria-label={t('star_toggle')}
            />
            <Button
              type="text" size="small" icon={<EditOutlined />}
              onClick={(e) => handleOpenRename(e, { id: dash.id, name: dash.name })}
              className="text-text-tertiary hover:text-brand" title={t('rename')}
              aria-label={t('rename')}
            />
            <OverflowMenuButton ariaLabel={t('more_dashboard_actions')} title={t('more_actions')}>
              {(closeOverflow) => (
                <>
                  <Button
                    type="text" block icon={<TagOutlined />}
                    className="!justify-start !text-left text-text-secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditTagsDashboardId(dash.id);
                      setPendingTags(dash.tags || []);
                      setTagInput('');
                      closeOverflow();
                    }}
                  >
                    {t('edit_tags')}
                  </Button>
                  {folders.length > 0 && (
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        onClick: ({ key }) => {
                          void assignDashboard(dash.id, key === '__root' ? null : key).catch((err) => {
                            message.error(err instanceof Error ? err.message : t('failed_move_folder'));
                          });
                          closeOverflow();
                        },
                        items: [
                          { key: '__root', label: t('no_folder') },
                          ...folders.map((f) => ({ key: f.id, label: f.name, icon: <FolderOutlined /> })),
                        ],
                        selectedKeys: assignments[dash.id] ? [assignments[dash.id]] : ['__root'],
                      }}
                    >
                      <Button
                        type="text" block icon={<FolderOutlined />}
                        className="!justify-start !text-left text-text-secondary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t('move_to_folder')}
                      </Button>
                    </Dropdown>
                  )}
                  <Button
                    type="text" block icon={<CopyOutlined />}
                    className="!justify-start !text-left text-text-secondary"
                    onClick={async (e) => {
                      e.stopPropagation();
                      closeOverflow();
                      try {
                        await duplicateDashboard(dash.id);
                        message.success(t('dashboard_duplicated'));
                      } catch {
                        message.error(t('dashboard_duplicate_failed'));
                      }
                    }}
                  >
                    {t('duplicate')}
                  </Button>
                  <Button
                    type="text" block danger icon={<DeleteOutlined />}
                    className="!justify-start !text-left"
                    onClick={(e) => {
                      closeOverflow();
                      handleOpenDelete(e, { id: dash.id, name: dash.name });
                    }}
                  >
                    {t('delete')}
                  </Button>
                </>
              )}
            </OverflowMenuButton>
          </div>
        </>
      )}
    </div>
  );

  const dashboardNavigator = (
    <div className="flex flex-col overflow-hidden mt-1 w-80 rounded-lg border border-border-light bg-bg-container shadow-md">
      <div className="flex flex-col gap-2 p-3 border-b border-border-light">
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
          <Link href={getChatHref({ mode: 'dashboard' })} className="block w-full" onClick={(e) => e.stopPropagation()}>
            <Button type="default" block size="small" icon={<RobotOutlined />}>
              {t('new_dashboard_with_ai')}
            </Button>
          </Link>
        ) : null}
        <Tooltip title={t('new_folder_hint')}>
          <Button
            type="text"
            size="small"
            icon={<FolderAddOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              void (async () => {
                try {
                  const id = await createFolder('New Folder');
                  setEditingFolderId(id);
                  setNewFolderName('New Folder');
                } catch (err) {
                  message.error(err instanceof Error ? err.message : t('failed_create_folder'));
                }
              })();
            }}
            title={t('new_folder')}
            aria-label={t('new_folder')}
          />
        </Tooltip>
      </div>
      <div className="p-3 border-b border-border-light">
        <Input
          prefix={<SearchOutlined className="text-text-tertiary" />}
          placeholder={t('search_dashboards')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          variant="filled"
          allowClear
        />
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {allTags.map((tag) => (
              <Tag
                key={tag}
                className={`!cursor-pointer !rounded-md !text-xs ${activeTagFilter === tag ? '!bg-brand !border-brand !text-white' : ''}`}
                onClick={(e) => { e.stopPropagation(); setActiveTagFilter(activeTagFilter === tag ? null : tag); }}
              >
                {tag}
              </Tag>
            ))}
          </div>
        )}
      </div>
      <div className="max-h-80 overflow-y-auto py-1.5">
        {isLoadingDashboards ? (
          <div className="flex items-center justify-center gap-2 px-6 py-6 text-text-tertiary text-[13px]">
            <Spin size="small" />
            <span>{t('loading_dashboards')}</span>
          </div>
        ) : dashboards.length === 0 ? (
          <div className="px-6 py-6 text-center text-text-tertiary text-[13px]">
            {t('no_dashboards_yet')}
          </div>
        ) : null}

        {/* Folder hierarchy — only show when there are folders or search is not active */}
        {!isLoadingDashboards && dashboards.length > 0 && folders.length > 0 && !searchTerm && !activeTagFilter && (
          <>
            {folders.map((folder) => {
              const folderDashes = filteredDashboards.filter((d) => assignments[d.id] === folder.id);
              const isCollapsed = collapsedFolderIds.has(folder.id);
              return (
                <div key={folder.id}>
                  {/* Folder header */}
                  <div
                    className="flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer select-none hover:bg-bg-elevated"
                    onClick={(e) => { e.stopPropagation(); toggleCollapse(folder.id); }}
                  >
                    <CaretRightOutlined
                      className="text-text-tertiary transition-transform"
                      style={{ fontSize: 10, transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
                    />
                    {isCollapsed ? <FolderOutlined className="text-brand text-sm" /> : <FolderOpenOutlined className="text-brand text-sm" />}
                    {editingFolderId === folder.id ? (
                      <Input
                        size="small"
                        autoFocus
                        value={newFolderName}
                        className="flex-1 text-xs"
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onBlur={() => {
                          if (newFolderName.trim()) {
                            void renameFolder(folder.id, newFolderName).catch((err) => {
                              message.error(err instanceof Error ? err.message : t('failed_rename_folder'));
                            });
                          }
                          setEditingFolderId(null);
                        }}
                        onPressEnter={() => {
                          if (newFolderName.trim()) {
                            void renameFolder(folder.id, newFolderName).catch((err) => {
                              message.error(err instanceof Error ? err.message : t('failed_rename_folder'));
                            });
                          }
                          setEditingFolderId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="flex-1 text-xs font-medium truncate">
                        {folder.name}
                        <span className="ml-1 text-text-disabled text-[10px]">({folderDashes.length})</span>
                      </span>
                    )}
                    <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <Tooltip title={t('rename_folder')}>
                        <Button type="text" size="small" icon={<EditOutlined />} className="text-text-tertiary"
                          onClick={(e) => { e.stopPropagation(); setEditingFolderId(folder.id); setNewFolderName(folder.name); }}
                          aria-label={t('rename_folder')}
                        />
                      </Tooltip>
                      <Tooltip title={t('delete_folder_hint')}>
                        <Button type="text" size="small" danger icon={<DeleteOutlined />}
                          aria-label={t('delete_folder')}
                          onClick={(e) => {
                            e.stopPropagation();
                            Modal.confirm({
                              title: t('delete_folder_title', { name: folder.name }),
                              content: t('delete_folder_body'),
                              okText: t('delete'),
                              okType: 'danger',
                              onOk: () =>
                                deleteFolder(folder.id).catch((err) => {
                                  message.error(err instanceof Error ? err.message : t('failed_delete_folder'));
                                }),
                            });
                          }}
                        />
                      </Tooltip>
                    </div>
                  </div>
                  {/* Folder contents */}
                  {!isCollapsed && (
                    <div className="pl-[18px]">
                      {folderDashes.length === 0 && (
                        <div className="px-3 py-1 text-[11px] text-text-disabled">{t('empty_folder')}</div>
                      )}
                      {folderDashes.map((dash) => renderDashItem(dash))}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Unassigned dashboards */}
            {filteredDashboards.filter((d) => !assignments[d.id]).length > 0 && folders.length > 0 && (
              <div className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-text-disabled">
                {t('unassigned')}
              </div>
            )}
          </>
        )}

        {/* Flat list (when no folders, or when searching/filtering) */}
        {!isLoadingDashboards && dashboards.length > 0 && (folders.length === 0 || searchTerm || activeTagFilter) && (
          filteredDashboards.length === 0 ? (
            <div className="px-6 py-6 text-center text-text-tertiary text-[13px]">{t('no_dashboards_found')}</div>
          ) : (
            filteredDashboards.map((dash) => renderDashItem(dash))
          )
        )}

        {/* Unassigned dashboards when folders exist and no filter active */}
        {!isLoadingDashboards && dashboards.length > 0 && folders.length > 0 && !searchTerm && !activeTagFilter && (
          filteredDashboards
            .filter((d) => !assignments[d.id])
            .map((dash) => renderDashItem(dash))
        )}
      </div>

      {(isLoadingTemplates || sampleTemplates.length > 0) && (
        <>
          <Divider className="!my-0" />
          <div className="px-3 py-2 max-h-40 overflow-y-auto">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-disabled mb-1.5">{t('sample_dashboards')}</div>
            {isLoadingTemplates ? (
              <div className="flex items-center gap-2 text-xs text-text-tertiary py-1">
                <Spin size="small" />
                <span>{t('loading_templates')}</span>
              </div>
            ) : (
              sampleTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="flex flex-col items-start w-full px-2.5 py-2 mb-1 rounded-md border border-border-light bg-bg-container text-left transition-colors hover:border-brand hover:bg-brand-subtle disabled:opacity-60 disabled:cursor-not-allowed"
                  disabled={!!creatingTemplateId}
                  onClick={() => createDashboardFromTemplate(template)}
                >
                  <span className="text-[13px] font-medium text-text">{template.name}</span>
                  <span className="text-[11px] text-text-tertiary">{template.category}</span>
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
        <Dropdown popupRender={() => dashboardNavigator} trigger={[]} open={false}>
          <Button
            type="text"
            className="!w-8 !h-8 !rounded-md !bg-brand-subtle !text-brand hover:!bg-brand-subtle"
            icon={<DashboardOutlined />}
            aria-label={t('dashboard')}
          />
        </Dropdown>

        <div className="flex flex-col gap-0 min-w-0 flex-1">
          {isEditMode && editingTitle ? (
            <Input
              className="!px-1 !rounded text-base font-semibold !h-7"
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
              className="border-none bg-transparent p-0 m-0 text-base font-semibold text-text text-left cursor-text truncate max-w-full"
              onClick={() => setEditingTitle(true)}
              title={t('click_edit_title')}
            >
              {activeDashboard?.name || t('dashboard')}
            </button>
          ) : (
            <span className="border-none bg-transparent p-0 m-0 text-base font-semibold text-text text-left cursor-default truncate max-w-full">
              {activeDashboard?.name || t('dashboard')}
            </span>
          )}

          {isEditMode && editingSubtitle ? (
            <Input
              className="!px-1 !rounded text-xs !h-6 !mt-0.5"
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
              className={`border-none bg-transparent p-0 m-0 text-xs text-left cursor-text truncate max-w-full ${subtitleDraft ? 'text-text-secondary' : 'text-text-tertiary italic'}`}
              onClick={() => setEditingSubtitle(true)}
              title={t('click_edit_subtitle')}
            >
              {subtitleDraft || t('subtitle_placeholder')}
            </button>
          ) : subtitleDraft ? (
            <span className="text-xs text-text-secondary truncate max-w-full">{subtitleDraft}</span>
          ) : null}
        </div>
      </div>

      <div className="toolbar-right">
        <Space size={8} align="center" className="toolbar-actions">
          {isSaving && (
            <div className="flex items-center gap-2 text-text-tertiary text-[13px]">
              <Spin size="small" />
              <span>{t('saving')}</span>
            </div>
          )}

          {isEditMode && collabConnected && collabPeerCount > 0 && (
            <Tooltip
              title={`${tp('live_sync')} · ${collabPeerCount + 1} ${tp('editors_online')}`}
            >
              <span
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-[var(--ant-color-success)] bg-[var(--ant-color-success-bg)] border border-[var(--ant-color-success-border)] cursor-default select-none"
                role="status"
                aria-label={`${tp('live_sync')} · ${collabPeerCount + 1} ${tp('editors_online')}`}
              >
                <span className="inline-flex items-center -mr-0.5">
                  {collabActiveUsers.slice(0, 4).map((u) => {
                    const uid = u.user_id || u.id || u.email || 'user';
                    const label = u.username || u.name || u.email || '?';
                    return (
                      <span
                        key={String(uid)}
                        className="inline-flex items-center justify-center w-[18px] h-[18px] -mr-1 rounded-full border border-bg-container text-white text-[10px] font-semibold leading-none"
                        style={{ background: u.color || 'var(--ant-color-primary)' }}
                        title={label}
                      >
                        {label.charAt(0).toUpperCase()}
                      </span>
                    );
                  })}
                </span>
                <TeamOutlined />
                <span className="leading-none">{collabPeerCount + 1}</span>
              </span>
            </Tooltip>
          )}

          {/* Secondary tools: undo/redo, version history (edit mode), zoom (always) */}
          <OverflowMenuButton ariaLabel={t('more_actions')} title={t('more_actions')}>
            {(closeOverflow) => (
              <>
                {isEditMode && (
                  <div className="flex items-center justify-between gap-2 px-1 py-1 text-sm text-text-secondary">
                    <span>{t('undo_redo')}</span>
                    <div className="flex items-center gap-0.5 rounded-md border border-border-light bg-bg-container p-0.5">
                      <button
                        type="button"
                        className="flex items-center justify-center w-7 h-7 rounded text-text-secondary text-sm transition-colors hover:bg-bg-elevated hover:text-text disabled:opacity-35 disabled:pointer-events-none"
                        disabled={!canUndo}
                        onClick={() => undo?.()}
                        title={t('undo_shortcut')}
                        aria-label={t('undo')}
                      >
                        <UndoOutlined />
                      </button>
                      <button
                        type="button"
                        className="flex items-center justify-center w-7 h-7 rounded text-text-secondary text-sm transition-colors hover:bg-bg-elevated hover:text-text disabled:opacity-35 disabled:pointer-events-none"
                        disabled={!canRedo}
                        onClick={() => redo?.()}
                        title={t('redo_shortcut')}
                        aria-label={t('redo')}
                      >
                        <RedoOutlined />
                      </button>
                    </div>
                  </div>
                )}

                {isEditMode && (
                  <Button
                    type="text"
                    block
                    icon={<HistoryOutlined />}
                    className="!justify-start !text-left text-text-secondary"
                    onClick={() => {
                      setVersionHistoryOpen(true);
                      closeOverflow();
                    }}
                  >
                    {t('version_history')}
                  </Button>
                )}

                <div className="flex items-center justify-between gap-2 px-1 py-1 text-sm text-text-secondary">
                  <span>{t('zoom')}</span>
                  <div className="flex items-center h-8 rounded-md border border-border-light bg-bg-container overflow-hidden">
                    <button
                      type="button"
                      className="flex items-center justify-center w-7 h-full text-text text-sm transition-colors hover:bg-bg-elevated disabled:opacity-35 disabled:pointer-events-none"
                      onClick={zoomOut}
                      disabled={canvasZoom <= 25}
                      title={t('zoom_out')}
                      aria-label={t('zoom_out')}
                    >
                      <ZoomOutOutlined />
                    </button>
                    <button
                      type="button"
                      className="flex items-center justify-center min-w-[42px] h-full border-x border-border-light text-text text-xs font-medium px-1 whitespace-nowrap transition-colors hover:bg-bg-elevated"
                      onClick={() => setCanvasZoom(100)}
                      title={t('reset_zoom')}
                      aria-label={t('reset_zoom')}
                    >
                      {canvasZoom}%
                    </button>
                    <button
                      type="button"
                      className="flex items-center justify-center w-7 h-full text-text text-sm transition-colors hover:bg-bg-elevated disabled:opacity-35 disabled:pointer-events-none"
                      onClick={zoomIn}
                      disabled={canvasZoom >= 200}
                      title={t('zoom_in')}
                      aria-label={t('zoom_in')}
                    >
                      <ZoomInOutlined />
                    </button>
                  </div>
                </div>
              </>
            )}
          </OverflowMenuButton>

          {/* Primary edit tools — industry pattern: undo/redo next to mode, not buried in overflow */}
          {isEditMode && (
            <div className="studio-primary-history inline-flex items-center rounded-md border border-border-light overflow-hidden shrink-0">
              <Tooltip title={t('undo_shortcut')}>
                <button
                  type="button"
                  className="flex items-center justify-center w-8 h-8 text-text-secondary hover:bg-bg-elevated disabled:opacity-35 disabled:pointer-events-none"
                  disabled={!canUndo}
                  onClick={() => undo?.()}
                  aria-label={t('undo')}
                >
                  <UndoOutlined />
                </button>
              </Tooltip>
              <Tooltip title={t('redo_shortcut')}>
                <button
                  type="button"
                  className="flex items-center justify-center w-8 h-8 text-text-secondary border-l border-border-light hover:bg-bg-elevated disabled:opacity-35 disabled:pointer-events-none"
                  disabled={!canRedo}
                  onClick={() => redo?.()}
                  aria-label={t('redo')}
                >
                  <RedoOutlined />
                </button>
              </Tooltip>
            </div>
          )}

          <button
            type="button"
            className={`inline-flex items-center gap-1.5 py-2 px-3 rounded-md border text-sm font-medium cursor-pointer shrink-0 transition-colors ${
              isEditMode
                ? 'border-border-light bg-bg-container text-text hover:border-brand'
                : 'border-brand/45 bg-brand-subtle text-brand'
            }`}
            onClick={() => setStudioMode(isEditMode ? 'view' : 'edit')}
            title={isEditMode ? t('switch_to_view') : t('switch_to_edit')}
            aria-pressed={isEditMode}
            aria-label={isEditMode ? t('mode_view_action') : t('mode_edit_action')}
          >
            {isEditMode ? <EyeOutlined /> : <EditOutlined />}
            <span>{isEditMode ? t('mode_view_action') : t('mode_edit_action')}</span>
          </button>

          {feedPostId && (
            <Tooltip
              title={
                snapshotOutdated
                  ? t('snapshot_outdated', { version: snapshotVersion ? `v${snapshotVersion}` : '' })
                  : t('feed_linked', { version: snapshotVersion ? `v${snapshotVersion}` : '' })
              }
            >
              {onUpdateSnapshot && snapshotOutdated ? (
                <Button
                  size="small"
                  type="text"
                  icon={<SyncOutlined spin={updatingSnapshot} style={{ color: '#f59e0b' }} />}
                  loading={updatingSnapshot}
                  onClick={onUpdateSnapshot}
                  aria-label={t('update_feed_snapshot')}
                  className="!w-8 !h-8 !p-0"
                />
              ) : (
                <Link href={feedPostUrl(feedPostId)}>
                  <Button
                    size="small"
                    type="text"
                    icon={<CompassOutlined className="text-text-tertiary" />}
                    aria-label={t('view_in_feed')}
                    className="!w-8 !h-8 !p-0"
                  />
                </Link>
              )}
            </Tooltip>
          )}

          {isEditMode && (
            <AddBlockPopover
              onSelect={handleSelectBlock}
              onAddFilterPreset={onAddFilterPreset}
              onApplyLayoutPreset={onApplyLayoutPreset}
              filtersPanelOpen={filtersPanelOpen}
              onOpenFilterPanel={onOpenFilterPanel}
              onOpenFilterManager={onOpenFilterManager}
            >
              <Button type="primary" icon={<PlusOutlined />}>
                {t('add')}
              </Button>
            </AddBlockPopover>
          )}

          {isEditMode && collabConnected && onCollabCommentsOpenChange && onCollabAddComment ? (
            <DashboardCollabCommentsPanel
              variant="toolbar"
              open={collabCommentsOpen}
              onOpenChange={onCollabCommentsOpenChange}
              comments={collabComments}
              selectedWidgetId={selectedWidgetId}
              onAddComment={onCollabAddComment}
              connected={collabConnected}
            />
          ) : null}

          <DashboardShareMenu
            dashboardId={activeDashboardId}
            dashboardName={activeDashboard?.name}
            onPreview={handlePreviewDashboard}
            onExport={(format) => void handleDashboardExport(format)}
            onPrint={handleDashboardPrint}
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
            onClick={toggleFullscreen}
            title={isFullscreen ? t('exit_full_screen') : t('full_screen')}
            aria-label={isFullscreen ? t('exit_full_screen') : t('full_screen')}
          />
        </Space>
      </div>

      {/* Feed Modal to Public functions */}
      <PublishToFeedModal
        open={isPublishOpen}
        assetType="dashboard"
        assetId={activeDashboardId || undefined}
        defaultTitle={activeDashboard?.name || t('dashboard')}
        defaultDescription={activeDashboard?.description || publishAutoDescription || ''}
        previewMetadata={publishPreviewMetadata}
        snapshotPayload={publishSnapshotPayload}
        renderMode="snapshot"
        organizationId={resolvedOrganizationId || undefined}
        projectId={resolvedProjectId || undefined}
        modalTitle={t('publish_dashboard_to_feed')}
        captureSelector=".dashboard-container"
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
            <span>{t('edit_tags')}</span>
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
        okText={t('save')}
        width={420}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              placeholder={t('tag_input_placeholder')}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onPressEnter={() => {
                const nextTag = tagInput.trim().toLowerCase();
                if (nextTag && !pendingTags.includes(nextTag)) {
                  setPendingTags([...pendingTags, nextTag]);
                }
                setTagInput('');
              }}
            />
            <Button
              onClick={() => {
                const nextTag = tagInput.trim().toLowerCase();
                if (nextTag && !pendingTags.includes(nextTag)) {
                  setPendingTags([...pendingTags, nextTag]);
                }
                setTagInput('');
              }}
            >
              {t('add')}
            </Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 32 }}>
            {pendingTags.length === 0 && (
              <span style={{ color: 'var(--ant-color-text-quaternary)', fontSize: 13 }}>{t('no_tags_yet')}</span>
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
