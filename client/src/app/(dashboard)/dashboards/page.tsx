'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Typography, ConfigProvider, Button, Spin, message, Divider, Tag, Alert, Modal, Select, Drawer } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  PlusOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './DashboardStudio.css';
import { PropertiesPanel } from './Properties/PropertiesPanel';
import DashboardCanvas from './Canvas/DashboardCanvas';
import { DashboardViewerGrid } from './components/viewer/DashboardViewerGrid';
import { useDashboardStore, type WidgetInstance, type LayoutItem, type RuntimeFilter, WidgetType, pushUndoSnapshot } from './stores/useDashboardStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { DashboardTabs } from './components/DashboardTabs';
import { StudioContextBar } from './components/StudioContextBar';
import { DashboardFilterPanel } from './components/DashboardFilterPanel';
import { collectDashboardDataSourceIds } from './utils/collectDashboardDataSourceIds';
import { useDashboardFilterContext } from './hooks/useDashboardFilterContext';
import { useStudioDashboardView } from './hooks/useStudioDashboardView';
import { useCollaboration } from '@/hooks/useCollaboration';
import { useDashboardCollaborationRoom } from './hooks/useCollaborationFeature';
import { DashboardCollabOverlay } from './components/DashboardCollabOverlay';
import { DashboardCollabCommentsPanel } from './components/DashboardCollabCommentsPanel';
import { DashboardRemixBanner } from './components/DashboardRemixBanner';
import { remixConfigFromDashboard } from './utils/remixSnapshotHydration';
import {
  feedPostIdFromDashboardConfig,
  computeStudioSnapshotFingerprint,
  isFeedSnapshotOutdated,
} from '@/app/(dashboard)/feed/utils/dashboardFeedBridge';
import { buildDashboardSnapshotPayload } from '@/app/(dashboard)/feed/utils/buildFeedSnapshotPayload';
import { socialFeedService, uploadFeedThumbnail } from '@/services/socialFeedService';
import { captureElementScreenshot } from '@/utils/captureElementScreenshot';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/constants/permissions';
import { applyPresetWithScaffolds } from './utils/layoutScaffolds';
import { inferPrimaryDataSourceId } from './utils/filterFieldUsage';
import type { DashboardFilter } from '@/types/dashboard';
import shortid from 'shortid';
import { type LayoutPreset } from './components/LayoutPresetsMenu';
import type { DashboardPageItem } from './components/DashboardPageTabs';
import { chartService, type DashboardTemplate } from './services/chartService';
import { WIDGET_TEMPLATES } from './widgetTemplates';
import { exitDocumentFullscreen } from './utils/studioNavigation';
import { useChartImportFromChat } from './hooks/useChartImportFromChat';
import { StudioSidebarRail, type SidebarSection } from './components/StudioSidebar/StudioSidebarRail';
import { StudioSidebarPanel } from './components/StudioSidebar/StudioSidebarPanel';
import { DashboardsSection } from './components/StudioSidebar/sections/DashboardsSection';
import { DataSection } from './components/StudioSidebar/sections/DataSection';
import { DataModelingSection } from './components/StudioSidebar/sections/DataModelingSection';
import type { DataModelRelationship } from '@/api/dataModel';
import { RelationshipDetailsPanel } from './components/ERDCanvas/RelationshipDetailsPanel';
import { useDashboardBuildProgress } from './hooks/useDashboardBuildProgress';
import { DashboardBuildLiveBanner } from './components/DashboardBuildLiveBanner';
import { isDashboardLiveBuild } from './utils/dashboardLiveBuildStorage';
import { CreateDashboardWizard, type WizardLayoutChoice } from './components/CreateDashboardWizard';
import {
  DEFAULT_CHART_PALETTE_ID,
  isKnownChartPalette,
  type ChartPaletteId,
} from './utils/chartPaletteCatalog';
import { maxLayoutY } from './utils/layoutSanitize';
import { formatApiValidationError, isValidUuid } from '@/utils/validationErrorMessage';
import { DashboardPageShell } from '@/components/layout/DashboardPageShell';

const { Title, Text } = Typography;
const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

const generateWidgetId = () => `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

// Redundant WidgetPreview removed - uses widgets/WidgetPreview.tsx via DashboardCanvas

export default function NewDashboardStudio() {
  const t = useTranslations('dashboards_page');
  const searchParams = useSearchParams();
  const requestedDashboardId = searchParams?.get('id');
  const requestedStudioMode = searchParams?.get('mode');
  const fromChatMessageId = searchParams?.get('from_chat');
  const liveBuildParam = searchParams?.get('live') === '1';
  const appliedDashboardIdRef = useRef<string | null>(null);
  const dashboards = useDashboardStore((s) => s.dashboards);
  const isLoadingDashboards = useDashboardStore((s) => s.isLoadingDashboards);
  const hasLoadedDashboards = useDashboardStore((s) => s.hasLoadedDashboards);
  const dashboardError = useDashboardStore((s) => s.dashboardError);
  const widgets = useDashboardStore((s) => s.widgets);
  const layout = useDashboardStore((s) => s.layout);
  const selectedWidgetId = useDashboardStore((s) => s.selectedWidgetId);
  const isPropertiesCollapsed = useDashboardStore((s) => s.isPropertiesCollapsed);
  const setWidgets = useDashboardStore((s) => s.setWidgets);
  const setLayout = useDashboardStore((s) => s.setLayout);
  const setSelectedWidgetId = useDashboardStore((s) => s.setSelectedWidgetId);
  const setPropertiesCollapsed = useDashboardStore((s) => s.setPropertiesCollapsed);
  const addWidgetToStore = useDashboardStore((s) => s.addWidget);
  const removeWidgetFromStore = useDashboardStore((s) => s.removeWidget);
  const duplicateWidgetFromStore = useDashboardStore((s) => s.duplicateWidget);
  const addDashboard = useDashboardStore((s) => s.addDashboard);
  const seedDashboardStarterLayout = useDashboardStore((s) => s.seedDashboardStarterLayout);
  const deleteChart = useDashboardStore((s) => s.deleteChart);
  const fetchDashboards = useDashboardStore((s) => s.fetchDashboards);
  const loadDashboardById = useDashboardStore((s) => s.loadDashboardById);
  const setActiveDashboardId = useDashboardStore((s) => s.setActiveDashboardId);
  const updateWidgetFromStore = useDashboardStore((s) => s.updateWidget);
  const updateChartLayout = useDashboardStore((s) => s.updateChartLayout);
  const updateChartAndFetchData = useDashboardStore((s) => s.updateChartAndFetchData);
  const applyDashboardColorPalette = useDashboardStore((s) => s.applyDashboardColorPalette);
  const isFullscreen = useDashboardStore((s) => s.isFullscreen);
  const setIsFullscreenState = useDashboardStore((s) => s.setIsFullscreen);
  const studioMode = useDashboardStore((s) => s.studioMode);
  const setStudioMode = useDashboardStore((s) => s.setStudioMode);
  const isEditMode = studioMode === 'edit' && !isFullscreen;
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);

  const liveBuildDashboardId = requestedDashboardId || activeDashboardId;
  const liveBuildEnabled =
    Boolean(liveBuildDashboardId) &&
    (liveBuildParam || isDashboardLiveBuild(liveBuildDashboardId || ''));
  const {
    progress: buildProgress,
    isConnected: isBuildLiveConnected,
    transport: buildTransport,
    isBuilding,
    hasNewWidgets,
  } = useDashboardBuildProgress(liveBuildDashboardId, liveBuildEnabled);

  useEffect(() => {
    if (!hasNewWidgets || !liveBuildDashboardId) return;
    void fetchDashboards();
  }, [hasNewWidgets, liveBuildDashboardId, fetchDashboards]);

  useEffect(() => {
    if (!activeDashboardId) return;
    const requestedMode =
      requestedStudioMode === 'edit' || requestedStudioMode === 'view'
        ? requestedStudioMode
        : fromChatMessageId
          ? 'view'
          : null;
    if (requestedMode && studioMode !== requestedMode) {
      setStudioMode(requestedMode);
    }
  }, [activeDashboardId, fromChatMessageId, requestedStudioMode, setStudioMode, studioMode]);

  const collabRoomId = useDashboardCollaborationRoom(activeDashboardId, isEditMode);
  const {
    connected: collabConnected,
    peerCount: collabPeers,
    activeUsers: collabActiveUsers,
    peerCursors: collabPeerCursors,
    comments: collabComments,
    addComment: collabAddComment,
    emitCursorMove: collabEmitCursorMove,
    emitWidgetEditing,
    peerEditingWidgetId,
    selfUserId: collabSelfUserId,
  } = useCollaboration(collabRoomId);

  const [collabCommentsOpen, setCollabCommentsOpen] = useState(false);

  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const td = useTranslations('dashboards');
  const filterCtx = useDashboardFilterContext(currentProjectId);
  const { handleRuntimeFiltersChange, runRefresh } = filterCtx;
  const handleToolbarRuntimeFiltersChange = useCallback(
    (nextFilters: RuntimeFilter[]) => {
      handleRuntimeFiltersChange(nextFilters);
      window.setTimeout(() => {
        void runRefresh(undefined, { silent: true });
      }, 0);
    },
    [handleRuntimeFiltersChange, runRefresh],
  );
  const handleToolbarClearFilters = useCallback(() => {
    handleToolbarRuntimeFiltersChange([]);
  }, [handleToolbarRuntimeFiltersChange]);

  const activeDashboard = useDashboardStore((s) =>
    s.dashboards.find((d) => d.id === s.activeDashboardId),
  );
  const linkedFeedPostId = feedPostIdFromDashboardConfig(
    activeDashboard?.config as Record<string, unknown> | undefined,
  );
  const remixSource = remixConfigFromDashboard(
    activeDashboard?.config as Record<string, unknown> | undefined,
  );
  const linkedFeedSnapshotVersion = Number(
    (activeDashboard?.config as Record<string, unknown> | undefined)?.feed_snapshot_version ?? 0,
  );
  const [updatingFeedSnapshot, setUpdatingFeedSnapshot] = useState(false);

  const feedSnapshotOutdated = useMemo(
    () =>
      linkedFeedPostId
        ? isFeedSnapshotOutdated({
            config: activeDashboard?.config as Record<string, unknown> | undefined,
            widgets: filterCtx.pageWidgets,
            layout: filterCtx.pageLayout,
            globalFilters: filterCtx.globalFiltersConfig,
            pageFilters: filterCtx.pageFiltersConfig,
            pages: filterCtx.pages.map((p) => ({ id: p.id, name: p.name })),
          })
        : false,
    [
      linkedFeedPostId,
      activeDashboard?.config,
      filterCtx.pageWidgets,
      filterCtx.pageLayout,
      filterCtx.globalFiltersConfig,
      filterCtx.pageFiltersConfig,
      filterCtx.pages,
    ],
  );

  const handleUpdateFeedSnapshot = useCallback(async () => {
    if (!linkedFeedPostId || !activeDashboardId || !activeDashboard) return;
    setUpdatingFeedSnapshot(true);
    try {
      const snapshotPayload = buildDashboardSnapshotPayload({
        dashboardId: activeDashboardId,
        title: activeDashboard.name,
        description: activeDashboard.description,
        widgets: filterCtx.pageWidgets,
        layout: filterCtx.pageLayout,
        globalFilters: filterCtx.globalFiltersConfig,
        pageFilters: filterCtx.pageFiltersConfig,
        pages: filterCtx.pages.map((p) => ({ id: p.id, name: p.name })),
        runtimeFilters: filterCtx.runtimeFilters,
        colorPalette: activeDashboard.config?.default_color_palette as string | undefined,
      });
      const fingerprint = computeStudioSnapshotFingerprint({
        widgets: filterCtx.pageWidgets,
        layout: filterCtx.pageLayout,
        globalFilters: filterCtx.globalFiltersConfig,
        pageFilters: filterCtx.pageFiltersConfig,
        pages: filterCtx.pages.map((p) => ({ id: p.id, name: p.name })),
      });
      // Best-effort thumbnail re-capture — never blocks the snapshot update;
      // a missing thumbnail just leaves the previous one in place.
      let thumbnailUrl: string | undefined;
      const screenshot = await captureElementScreenshot('.dashboard-container', {
        toggleClassName: 'dashboard-export-light',
      });
      if (screenshot) {
        thumbnailUrl = (await uploadFeedThumbnail(screenshot)) ?? undefined;
      } else {
        message.warning(td('feed_snapshot_thumbnail_failed'));
      }

      const result = await socialFeedService.updatePublicationSnapshot(linkedFeedPostId, {
        snapshot_payload: snapshotPayload as unknown as Record<string, unknown>,
        title: activeDashboard.name,
        description: activeDashboard.description,
        thumbnail_url: thumbnailUrl,
      });
      await useDashboardStore.getState().updateDashboardMeta(activeDashboardId, {
        config: {
          ...((activeDashboard.config as Record<string, unknown>) || {}),
          feed_snapshot_version: result.snapshot_version ?? linkedFeedSnapshotVersion + 1,
          feed_snapshot_fingerprint: fingerprint,
        },
      });
      message.success(td('feed_snapshot_updated'));
    } catch (err) {
      message.error(formatApiValidationError(err));
    } finally {
      setUpdatingFeedSnapshot(false);
    }
  }, [
    linkedFeedPostId,
    activeDashboardId,
    activeDashboard,
    filterCtx.pageWidgets,
    filterCtx.pageLayout,
    filterCtx.globalFiltersConfig,
    filterCtx.pageFiltersConfig,
    filterCtx.pages,
    filterCtx.runtimeFilters,
    linkedFeedSnapshotVersion,
    td,
  ]);

  const handleCollabAddComment = useCallback(
    (text: string, widgetId?: string | null) => {
      collabAddComment(text, widgetId);
      if (!linkedFeedPostId || !text.trim()) return;
      const feedBody = widgetId ? `[Widget] ${text.trim()}` : text.trim();
      void socialFeedService.addComment(linkedFeedPostId, feedBody).catch(() => {
        /* studio socket comment still visible; feed sync is best-effort */
      });
    },
    [collabAddComment, linkedFeedPostId],
  );

  const studioDefaultPageId =
    filterCtx.defaultPageIdRef.current ?? filterCtx.pages[0]?.id ?? null;

  const studioView = useStudioDashboardView({
    pages: filterCtx.pages,
    activePageId: filterCtx.activePageId,
    defaultPageId: studioDefaultPageId,
  });

  const dashboardDataSourceIds = useMemo(
    () => collectDashboardDataSourceIds(filterCtx.pageWidgets, filterCtx.combinedFiltersConfig),
    [filterCtx.pageWidgets, filterCtx.combinedFiltersConfig],
  );

  useEffect(() => {
    if (!isEditMode && filterCtx.combinedFiltersConfig.length > 0) {
      filterCtx.setFiltersPanelOpen(true);
    }
  }, [isEditMode, filterCtx.combinedFiltersConfig.length, filterCtx.setFiltersPanelOpen]);

  const chartImport = useChartImportFromChat();
  const [mounted, setMounted] = useState(false);

  const [sidebarSection, setSidebarSection] = useState<SidebarSection | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem('studio_sidebar_state');
      if (saved) {
        const { section, open } = JSON.parse(saved) as { section: SidebarSection; open: boolean };
        return open ? section : null;
      }
    } catch {
      // ignore parse errors
    }
    return null;
  });

  const handleSidebarSectionChange = useCallback((section: SidebarSection | null) => {
    setSidebarSection(section);
    try {
      localStorage.setItem(
        'studio_sidebar_state',
        JSON.stringify({ section, open: section !== null }),
      );
    } catch {
      // ignore storage errors
    }
  }, []);
  const [selectedRelationship, setSelectedRelationship] = useState<DataModelRelationship | null>(null);

  const [sampleTemplates, setSampleTemplates] = useState<DashboardTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [creatingDashboard, setCreatingDashboard] = useState(false);
  const dashboardColorPalette = useDashboardStore((s) => {
    const dash = s.dashboards.find((d) => d.id === s.activeDashboardId);
    const fromConfig = dash?.config?.default_color_palette as ChartPaletteId | undefined;
    return fromConfig && isKnownChartPalette(fromConfig) ? fromConfig : DEFAULT_CHART_PALETTE_ID;
  });

  const handleWizardCreateWithLayout = useCallback(
    async (name: string, layout: WizardLayoutChoice) => {
      setCreatingDashboard(true);
      try {
        await addDashboard(name);
        if (layout === 'kpi' || layout === 'executive') {
          await seedDashboardStarterLayout(layout, filterCtx.activePageId);
        }
        message.success(t('dashboard_created_success'));
      } catch (err) {
        message.error(formatApiValidationError(err));
        throw err;
      } finally {
        setCreatingDashboard(false);
      }
    },
    [addDashboard, seedDashboardStarterLayout, filterCtx.activePageId, t]
  );

  useEffect(() => {
    setMounted(true);
    void exitDocumentFullscreen();
    setIsFullscreenState(false);

    const content = document.querySelector('.ant-layout-content');
    content?.classList.add('dashboard-studio-layout');
    if (content instanceof HTMLElement) content.scrollTop = 0;
    window.scrollTo(0, 0);

    return () => {
      content?.classList.remove('dashboard-studio-layout');
    };
  }, [setIsFullscreenState]);

  // Fetch dashboards when mounted and project changes
  useEffect(() => {
    if (mounted && (!isEnterpriseEdition || currentProjectId)) {
      appliedDashboardIdRef.current = null;
      fetchDashboards();
    }
  }, [mounted, currentProjectId, fetchDashboards]);

  // Restore dashboard from URL after list loads (e.g. returning from preview,
  // or opening a chat-generated dashboard via deep link)
  useEffect(() => {
    if (!hasLoadedDashboards || !requestedDashboardId) return;
    if (appliedDashboardIdRef.current === requestedDashboardId) return;
    appliedDashboardIdRef.current = requestedDashboardId;
    const match = dashboards.find((d) => String(d.id) === String(requestedDashboardId));
    if (match) {
      if (String(activeDashboardId) !== String(requestedDashboardId)) {
        setActiveDashboardId(requestedDashboardId);
      }
      return;
    }
    // Not in the current project's list (e.g. just created from chat) —
    // fetch it directly so the deep link never silently opens another dashboard.
    void loadDashboardById(requestedDashboardId).then((loaded) => {
      if (!loaded) message.warning(t('dashboard_not_found'));
    });
  }, [
    hasLoadedDashboards,
    requestedDashboardId,
    dashboards,
    activeDashboardId,
    setActiveDashboardId,
    loadDashboardById,
    t,
  ]);

  // Load sample dashboard templates for empty-state onboarding.
  useEffect(() => {
    let cancelled = false;

    const loadTemplates = async () => {
      if (!mounted || dashboards.length > 0) return;
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
        console.error('Failed to load dashboard templates:', error);
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
  }, [mounted, dashboards.length]);

  const handleDashboardColorPaletteChange = useCallback(
    async (paletteId: ChartPaletteId) => {
      try {
        await applyDashboardColorPalette(paletteId);
        message.success(td('palette_applied_success'));
      } catch (err) {
        message.error(formatApiValidationError(err));
      }
    },
    [applyDashboardColorPalette, td],
  );

  useEffect(() => {
    if (!isEditMode || !selectedWidgetId) {
      emitWidgetEditing?.(null);
      return;
    }
    emitWidgetEditing?.(selectedWidgetId);
  }, [isEditMode, selectedWidgetId, emitWidgetEditing]);

  // Handle browser fullscreen change
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreenState(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, [setIsFullscreenState]);

  const onUpdateWidget = async (id: string, updates: any) => {
    // Optimistic UI update
    updateWidgetFromStore(id, updates);

    // Persist if widget has chartId (backend connected)
    const widget = widgets.find((w) => w.id === id);
    if (widget?.chartId) {
      try {
        // This will persist AND re-fetch data (overkill for title but ensures consistency)
        await updateChartAndFetchData(id, updates);
      } catch (err) {
        console.error('Failed to save widget updates:', err);
        // Silent fail for title update usually, but maybe show error if critical
      }
    }
  };

  const addWidget = async (template: (typeof WIDGET_TEMPLATES)[number]) => {
    const instanceId = generateWidgetId();

    const isPieChart = template.type === 'pie' || template.type === 'donut';
    const isTextWidget = template.type === 'text';
    const isSlicerWidget = template.type === 'slicer';
    const isFilterWidget = template.type === 'filter';
    const isDividerWidget = template.type === 'divider';
    const isImageWidget = template.type === 'image';
    const isNonDataWidget = isTextWidget || isSlicerWidget || isFilterWidget || isDividerWidget || isImageWidget;

    let defaultChartOptions;
    let defaultChartQuery: WidgetInstance['chartQuery'];

    if (isTextWidget) {
      defaultChartOptions = {
        content: '',
        fontSize: 14,
        fontWeight: 400,
        color: 'inherit',
        textAlign: 'left',
      };
      defaultChartQuery = {};
    } else if (isSlicerWidget) {
      defaultChartOptions = { slicerLabel: template.name };
      defaultChartQuery = { mode: 'single' as const };
    } else if (isFilterWidget) {
      defaultChartOptions = { slicerLabel: template.name };
      defaultChartQuery = { mode: 'multi' as const };
    } else if (isDividerWidget) {
      defaultChartOptions = { sectionTitle: '', uppercase: true };
      defaultChartQuery = {};
    } else if (isImageWidget) {
      defaultChartOptions = { imageUrl: '', objectFit: 'contain' };
      defaultChartQuery = {};
    } else if (isPieChart) {
      defaultChartOptions = {
        showLegend: true,
        showDataLabel: false,
        innerRadius: template.type === 'donut' ? 40 : 0,
      };
    } else if (template.type === 'gauge') {
      defaultChartOptions = { gaugeMin: 0, gaugeMax: 100, showLegend: false };
    } else {
      defaultChartOptions = {
        showLegend: true,
        showDataLabel: false,
        showGridline: true,
        showAxis: true,
      };
    }

    const newWidget: WidgetInstance = {
      id: instanceId,
      dataSourceId: undefined,
      chartQuery: isNonDataWidget ? defaultChartQuery : undefined,
      chartType: template.type as WidgetType,
      title: isTextWidget || isDividerWidget ? '' : template.name,
      chartOptions: defaultChartOptions,
    };

    const nextLayoutItem: LayoutItem = {
      i: instanceId,
      x: 0,
      y: maxLayoutY(layout),
      w: template.defaultSize.w,
      h: template.defaultSize.h,
      ...(filterCtx.activePageId ? { pageId: filterCtx.activePageId } : {}),
    };

    addWidgetToStore(newWidget, nextLayoutItem);

    if (isNonDataWidget) {
      useDashboardStore.getState().createChartAndFetchData(newWidget);
    }

    setSelectedWidgetId(instanceId);
    setPropertiesCollapsed(false);
  };

  const removeWidget = async (id: string) => {
    const widget = widgets.find((w) => w.id === id);

    // Close properties panel if deleting the selected widget
    if (selectedWidgetId === id) {
      setSelectedWidgetId(null);
      setPropertiesCollapsed(true);
    }

    // Delete from backend if it has a chartId
    if (widget?.chartId) {
      try {
        await deleteChart(id);
        message.success(t('chart_deleted_success'));
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : t('failed_delete_chart');
        console.error('Failed to delete chart:', error);
        message.error(errorMsg);
        // Still remove from UI to prevent orphaned widgets
        removeWidgetFromStore(id);
      }
    } else {
      removeWidgetFromStore(id);
    }
  };

  const duplicateWidget = async (id: string) => {
    try {
      duplicateWidgetFromStore(id);
      message.success(t('widget_duplicated_success'));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : t('failed_duplicate_widget');
      console.error('Failed to duplicate widget:', error);
      message.error(errorMsg);
    }
  };

  const selectedWidget = useMemo(
    () => widgets.find((w) => w.id === selectedWidgetId) ?? null,
    [widgets, selectedWidgetId]
  );

  const layoutSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleLayoutSync = useCallback(
    (newLayout: LayoutItem[]) => {
      // Capture undo snapshot before persisting the layout change
      pushUndoSnapshot();
      if (layoutSyncTimerRef.current) clearTimeout(layoutSyncTimerRef.current);
      layoutSyncTimerRef.current = setTimeout(() => {
        newLayout.forEach((l) => {
          const widget = widgets.find((w) => w.id === l.i);
          if (widget?.chartId) void updateChartLayout(widget.id, l);
        });
      }, 400);
    },
    [widgets, updateChartLayout]
  );

  useEffect(
    () => () => {
      if (layoutSyncTimerRef.current) clearTimeout(layoutSyncTimerRef.current);
    },
    []
  );

  const applyLayoutPreset = useCallback(
    (preset: LayoutPreset) => {
      const defaultPage = filterCtx.defaultPageIdRef.current || filterCtx.pages[0]?.id || null;
      const scopedItems = filterCtx.pageLayout.length ? filterCtx.pageLayout : layout;
      const ordered = [...scopedItems].sort((a, b) => a.y - b.y || a.x - b.x);
      const { nextLayout, newWidgets, newLayoutItems } = applyPresetWithScaffolds(
        preset,
        ordered,
        widgets,
      );
      const fullLayout = [...nextLayout, ...newLayoutItems];
      filterCtx.updatePageLayout(filterCtx.activePageId, fullLayout, defaultPage);
      newWidgets.forEach((widget, index) => {
        addWidgetToStore(widget, newLayoutItems[index]);
      });
      fullLayout.forEach((l) => {
        const w = widgets.find((wi) => wi.id === l.i) || newWidgets.find((wi) => wi.id === l.i);
        if (w?.chartId) void filterCtx.updateChartLayout(w.id, l);
      });
      if (newWidgets.length > 0) {
        message.success(t('layout_preset_scaffolds_added', { count: newWidgets.length }));
      }
    },
    [filterCtx, layout, widgets, addWidgetToStore, t],
  );

  const handleAddFilterPreset = useCallback(
    async (partial: Partial<DashboardFilter>) => {
      const primaryDs = inferPrimaryDataSourceId(widgets);
      const filter: DashboardFilter = {
        id: shortid.generate(),
        name: partial.name || td('new_filter_default'),
        type: partial.type || 'dropdown',
        field: partial.field || '',
        isGlobal: true,
        ...(primaryDs ? { dataSourceId: primaryDs } : {}),
        ...partial,
      };
      const next = [...filterCtx.globalFiltersConfig, filter];
      await filterCtx.saveGlobalFilters(next);
      // Compact UX: open the lightweight filter panel so the user can immediately apply/adjust values.
      // (Open the heavy editor only if the user explicitly clicks "Manage filters" from the top bar.)
      filterCtx.setFiltersPanelOpen(true);
    },
    [filterCtx, widgets, td],
  );

  const createFromTemplate = async (template: DashboardTemplate, dashboardName?: string) => {
    if (isEnterpriseEdition && !isValidUuid(currentProjectId != null ? String(currentProjectId) : null)) {
      throw new Error('Select a valid project before creating a dashboard');
    }

    setCreatingTemplateId(template.id);
    try {
      const response = await chartService.createDashboardFromTemplate({
        templateId: template.id,
        projectId: isEnterpriseEdition ? currentProjectId : undefined,
        dashboardName: dashboardName || template.default_dashboard_name,
      });

      await fetchDashboards();
      const createdId = response?.dashboard?.id;
      if (createdId) {
        setActiveDashboardId(String(createdId));
      }

      const title = response?.dashboard?.title || template.default_dashboard_name || template.name;
      message.success(`Created ${title}`);
    } catch (error) {
      message.error(formatApiValidationError(error));
      throw error;
    } finally {
      setCreatingTemplateId(null);
    }
  };

  const isFullPageSection = sidebarSection === 'data' || sidebarSection === 'modeling';

  if (!mounted) return null;

  // Show error state if fetching failed
  if (dashboardError) {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#00c2cb',
            borderRadius: 6,
          },
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100%',
            textAlign: 'center',
            gap: '24px',
            padding: '48px',
          }}
        >
          <Title level={3} type="danger">
            {t('failed_load')}
          </Title>
          <Text type="secondary">{dashboardError}</Text>
          <Button type="primary" onClick={() => fetchDashboards()}>
            {t('retry')}
          </Button>
        </div>
      </ConfigProvider>
    );
  }

  // Show loading state while fetching dashboards or waiting for project or first load
  if (isLoadingDashboards || (isEnterpriseEdition && !currentProjectId) || !hasLoadedDashboards) {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#00c2cb',
            borderRadius: 6,
          },
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100%',
            gap: '16px',
          }}
        >
          <Spin size="large" />
          <Text type="secondary">
            {isEnterpriseEdition && !currentProjectId ? t('waiting_project') : t('loading_dashboards')}
          </Text>
          {isEnterpriseEdition && !currentProjectId && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t('waiting_project_hint')}
            </Text>
          )}
        </div>
      </ConfigProvider>
    );
  }

  // Show empty state ONLY when project is selected but has no dashboards
  if (dashboards.length === 0) {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#00c2cb',
            borderRadius: 6,
          },
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100%',
            textAlign: 'center',
            gap: '24px',
            padding: '48px',
            background: 'var(--ant-color-bg-container)',
          }}
        >
          <DashboardOutlined style={{ fontSize: '64px', color: 'var(--color-brand-primary)' }} />
          <div>
            <Title level={3} style={{ margin: '0 0 8px 0' }}>
              {t('create_first_dashboard')}
            </Title>
            <Text type="secondary" style={{ fontSize: '14px' }}>
              {t('create_first_dashboard_desc')}
            </Text>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => setWizardOpen(true)}
            style={{ marginTop: '16px' }}
          >
            {t('create_dashboard')}
          </Button>

          <Divider style={{ margin: '8px 0 0 0', maxWidth: '840px' }}>{t('or_sample_dashboard')}</Divider>

          {isLoadingTemplates ? (
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
              <Spin size="small" />
            </div>
          ) : sampleTemplates.length > 0 ? (
            <div
              style={{
                width: '100%',
                maxWidth: 1080,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                gap: 12,
                marginTop: 8,
              }}
            >
              {sampleTemplates.map((template) => (
                <div
                  key={template.id}
                  style={{
                    border: '1px solid var(--ant-color-border)',
                    borderRadius: 10,
                    padding: 14,
                    background: 'var(--ant-color-bg-elevated)',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    minHeight: 232,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <Text strong style={{ lineHeight: 1.3 }}>
                      {template.name}
                    </Text>
                    <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
                      {template.category}
                    </Tag>
                  </div>

                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {template.description}
                  </Text>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(template.widgets || []).slice(0, 3).map((widget) => (
                      <Tag key={`${template.id}-${widget.name}`} style={{ marginInlineEnd: 0 }}>
                        {widget.name}
                      </Tag>
                    ))}
                  </div>

                  <Button
                    type="default"
                    loading={creatingTemplateId === template.id}
                    onClick={() => createFromTemplate(template)}
                    style={{ marginTop: 'auto' }}
                  >
                    Use Template
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Text type="secondary" style={{ marginTop: 12 }}>
              No sample dashboards available right now.
            </Text>
          )}
        </div>
        <CreateDashboardWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          templates={sampleTemplates}
          creating={creatingDashboard}
          onCreateWithLayout={handleWizardCreateWithLayout}
          onCreateFromTemplate={async (template, name) => {
            setCreatingDashboard(true);
            try {
              await createFromTemplate(template, name);
              message.success(t('dashboard_created_success'));
            } catch (err) {
              message.error(formatApiValidationError(err));
            } finally {
              setCreatingDashboard(false);
            }
          }}
        />
      </ConfigProvider>
    );
  }

  return (
    <PermissionGuard
      permission={Permission.DASHBOARD_VIEW}
      loadingFallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
          <Spin size="large" tip={t('loading_dashboards')} />
        </div>
      }
      fallback={
        <div style={{ padding: 48, maxWidth: 480, margin: '0 auto' }}>
          <Alert type="warning" showIcon message={t('no_dashboard_permission')} description={t('no_dashboard_permission_desc')} />
        </div>
      }
    >
    <DashboardPageShell fullBleed>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#00c2cb',
          borderRadius: 6,
        },
      }}
    >
      <div
        className={`studio-wrapper dashboard-studio-root ${!isEditMode ? 'view-mode' : ''}`}
        id="studio-wrapper"
      >
        <div className="studio-body">
          <main
            className="studio-canvas-area"
            style={{
              flexDirection: 'column',
              display: 'flex',
              padding: 0,
              // Reserve room for the absolute properties panel (300px) so its overlay
              // never hides the right end of the toolbar / widget edges.
              // paddingRight: isEditMode && !isPropertiesCollapsed ? 300 : 0,
              transition: 'padding-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {/* Dashboard Selector Tabs & Toolbar — Hidden in Fullscreen */}
            {!isFullscreen && (
              <>
              <DashboardTabs
                onAddBlock={(type) => {
                  const template = WIDGET_TEMPLATES.find((tpl) => tpl.type === type);
                  if (template) void addWidget(template);
                }}
                onAddFilterPreset={(preset) => void handleAddFilterPreset(preset)}
                onApplyLayoutPreset={applyLayoutPreset}
                filtersPanelOpen={filterCtx.filtersPanelOpen}
                onOpenFilterPanel={() => filterCtx.setFiltersPanelOpen(!filterCtx.filtersPanelOpen)}
                onOpenFilterManager={() => filterCtx.setFiltersEditorOpen(true)}
                activePageId={filterCtx.activePageId}
                pages={filterCtx.pages}
                runtimeFilters={filterCtx.runtimeFilters}
                collabConnected={collabConnected}
                collabPeerCount={collabPeers}
                collabActiveUsers={collabActiveUsers}
                feedPostId={linkedFeedPostId || null}
                snapshotOutdated={feedSnapshotOutdated}
                snapshotVersion={linkedFeedSnapshotVersion || undefined}
                onUpdateSnapshot={linkedFeedPostId ? () => void handleUpdateFeedSnapshot() : undefined}
                updatingSnapshot={updatingFeedSnapshot}
              />
              {remixSource ? (
                <DashboardRemixBanner remix={remixSource} dashboardTitle={activeDashboard?.name} />
              ) : null}
              </>
            )}

            <div className="dashboard-workspace">
            <StudioSidebarRail
              activeSection={sidebarSection}
              onSectionChange={handleSidebarSectionChange}
            />
            <StudioSidebarPanel activeSection={sidebarSection} isFullPage={isFullPageSection}>
              {sidebarSection === 'dashboards' && <DashboardsSection />}
              {sidebarSection === 'data' && <DataSection />}
              {sidebarSection === 'modeling' && (
                <DataModelingSection
                  onRelationshipSelect={setSelectedRelationship}
                  selectedRelationshipId={selectedRelationship?.id ?? null}
                />
              )}
            </StudioSidebarPanel>
            <div className="dashboard-workspace-main" style={{ display: isFullPageSection ? 'none' : undefined }}>
            <div
              className={`dashboard-page-chrome${isFullscreen ? ' dashboard-page-chrome-presentation' : ''}`}
            >
              <StudioContextBar
                pages={filterCtx.pages}
                activePageId={filterCtx.activePageId}
                defaultPageId={filterCtx.defaultPageIdRef.current}
                globalFiltersConfig={filterCtx.globalFiltersConfig}
                pageFiltersConfig={filterCtx.pageFiltersConfig}
                combinedFiltersConfig={filterCtx.combinedFiltersConfig}
                runtimeFilters={filterCtx.runtimeFilters}
                onRuntimeFiltersChange={filterCtx.handleRuntimeFiltersChange}
                filtersPanelOpen={filterCtx.filtersPanelOpen}
                onFiltersPanelOpenChange={filterCtx.setFiltersPanelOpen}
                filtersEditorOpen={filterCtx.filtersEditorOpen}
                onFiltersEditorOpenChange={filterCtx.setFiltersEditorOpen}
                pageFiltersEditorOpen={filterCtx.pageFiltersEditorOpen}
                onPageFiltersEditorOpenChange={filterCtx.setPageFiltersEditorOpen}
                onSavePageFilters={filterCtx.savePageFilters}
                dataSourceOptions={filterCtx.dataSourceOptions}
                tableOptionsBySource={filterCtx.tableOptionsBySource}
                widgetScopeOptions={filterCtx.widgetScopeOptions}
                filterFieldConflicts={filterCtx.filterFieldConflicts}
                // dataSourcesForFilters={filterCtx.dataSourcesForFilters}
                dashboardId={activeDashboardId ?? undefined}
                studioWidgets={widgets}
                onSaveGlobalFilters={filterCtx.saveGlobalFilters}
                fetchFilterOptions={filterCtx.fetchFilterOptions}
                widgetCount={filterCtx.pageWidgets.length}
                onApplyLayoutPreset={applyLayoutPreset}
                onResetLayout={() => {
                  const defaultPage = filterCtx.defaultPageIdRef.current || filterCtx.pages[0]?.id || null;
                  const reset = filterCtx.pageLayout.map((l, i) => ({ ...l, x: 0, y: i * 5, w: l.w, h: l.h }));
                  filterCtx.updatePageLayout(filterCtx.activePageId, reset, defaultPage);
                }}
                hideLayout={isFullscreen || !isEditMode}
                onRefresh={isEditMode && !isFullscreen ? filterCtx.handleManualRefresh : undefined}
                refreshing={filterCtx.refreshing}
                lastRefreshedLabel={isEditMode && !isFullscreen ? filterCtx.lastRefreshedLabel : undefined}
                autoRefreshMinutes={filterCtx.autoRefreshMinutes}
                onAutoRefreshIntervalChange={isEditMode && !isFullscreen ? filterCtx.setAutoRefreshMinutes : undefined}
                dashboardColorPalette={dashboardColorPalette}
                onDashboardColorPaletteChange={
                  isEditMode && !isFullscreen
                    ? (id) => void handleDashboardColorPaletteChange(id)
                    : undefined
                }
                readOnly={!isEditMode}
                presentationMode={isFullscreen}
                presentationTitle={
                  dashboards.find((d) => d.id === activeDashboardId)?.name
                }
                onExitPresentation={() => void exitDocumentFullscreen()}
                dataSourceIds={dashboardDataSourceIds}
                pageTabProps={{
                  showEmptyPlaceholder: true,
                  readOnly: !isEditMode,
                  onSelect: filterCtx.setActivePageId,
                  onCreate: async (name) => {
                    if (!activeDashboardId) return;
                    const page = await chartService.createPage(activeDashboardId, name);
                    filterCtx.setPages((prev) => [...prev, page]);
                    filterCtx.setActivePageId(page.id);
                    if (filterCtx.pages.length === 0) {
                      filterCtx.defaultPageIdRef.current = page.id;
                      await chartService.setDefaultPage(activeDashboardId, page.id);
                    }
                  },
                  onRename: async (pageId, name) => {
                    if (!activeDashboardId) return;
                    await chartService.updatePage(activeDashboardId, pageId, { name });
                    filterCtx.setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, name } : p)));
                  },
                    onDelete: async (pageId, moveWidgetsToPageId) => {
                      await filterCtx.deletePage(pageId, moveWidgetsToPageId);
                    },
                  onReorder: async (pageIds) => {
                    if (!activeDashboardId) return;
                    const reordered = await chartService.reorderPages(activeDashboardId, pageIds);
                    filterCtx.setPages(reordered as DashboardPageItem[]);
                  },
                  onSetDefault: async (pageId) => {
                    if (!activeDashboardId) return;
                    await chartService.setDefaultPage(activeDashboardId, pageId);
                    filterCtx.defaultPageIdRef.current = pageId;
                    message.success(td('default_page_set'));
                  },
                }}
              />
              {filterCtx.combinedFiltersConfig.length > 0 &&
              (!isEditMode || isFullscreen) ? (
                <DashboardFilterPanel
                  variant="toolbar"
                  filters={filterCtx.combinedFiltersConfig}
                  runtimeFilters={filterCtx.runtimeFilters}
                  onChange={handleToolbarRuntimeFiltersChange}
                  fetchOptions={filterCtx.fetchFilterOptions}
                  fetchFieldStats={filterCtx.fetchFilterFieldStats}
                  minimal={!isEditMode || isFullscreen}
                  showHeader={false}
                  onClearAll={handleToolbarClearFilters}
                  onRefresh={filterCtx.handleManualRefresh}
                  refreshing={filterCtx.refreshing}
                />
              ) : null}
            </div>

            <div
              className="studio-canvas-scroll"
              style={{
                flex: 1,
                width: '100%',
                overflowX: 'hidden',
                overflowY: 'auto',
                minHeight: 0,
                padding: isFullscreen ? '8px 24px 24px' : '16px',
                position: 'relative',
              }}
              onClick={() => {
                setSelectedWidgetId(null);
                setPropertiesCollapsed(true);
              }}
            >
              {isEditMode && collabConnected ? (
                <DashboardCollabOverlay cursors={collabPeerCursors} selfUserId={collabSelfUserId} />
              ) : null}
              {isEditMode && collabConnected ? (
                <div className="dashboard-collab-comments-anchor">
                  <DashboardCollabCommentsPanel
                    open={collabCommentsOpen}
                    onOpenChange={setCollabCommentsOpen}
                    comments={collabComments}
                    selectedWidgetId={selectedWidgetId}
                    onAddComment={handleCollabAddComment}
                    connected={collabConnected}
                  />
                </div>
              ) : null}
              {isBuilding && buildProgress ? (
                <DashboardBuildLiveBanner
                  progress={buildProgress}
                  isConnected={isBuildLiveConnected}
                  transport={buildTransport}
                />
              ) : null}
              {!isEditMode && activeDashboardId ? (
                <DashboardViewerGrid
                  widgets={studioView.visibleWidgets}
                  layout={studioView.visibleLayout}
                  dashboardId={activeDashboardId}
                  runtimeFilters={filterCtx.runtimeFilters}
                  onCrossFilter={filterCtx.handleCrossFilter}
                  onWidgetChartClick={filterCtx.handleWidgetChartClick}
                  onRetryWidget={studioView.handleRetryWidget}
                  refreshing={filterCtx.refreshing}
                />
              ) : (
              <DashboardCanvas
                widgets={filterCtx.pageWidgets}
                layout={filterCtx.pageLayout}
                dashboardId={activeDashboardId ?? undefined}
                runtimeFilters={filterCtx.runtimeFilters}
                onCrossFilter={filterCtx.handleCrossFilter}
                onWidgetChartClick={filterCtx.handleWidgetChartClick}
                readOnly={!isEditMode}
                pages={filterCtx.pages}
                onMoveWidgetToPage={async (widgetId, pageId) => {
                  await filterCtx.moveWidgetToPage(widgetId, pageId);
                  message.success(td('move_to_page_success'));
                }}
                selectedWidgetId={selectedWidgetId}
                setSelectedWidgetId={setSelectedWidgetId}
                setLayout={setLayout}
                onPageLayoutChange={filterCtx.handlePageLayoutChange}
                peerEditingWidgetId={peerEditingWidgetId}
                onCollabCursorMove={collabConnected ? collabEmitCursorMove : undefined}
                removeWidget={removeWidget}
                duplicateWidget={duplicateWidget}
                onAddWidget={(template) => {
                  if (template) addWidget(template);
                }}
                onDropWidget={(template) => addWidget(template)}
                setPropertiesCollapsed={setPropertiesCollapsed}
                onUpdateWidget={onUpdateWidget}
                onLayoutSync={scheduleLayoutSync}
              />
              )}
            </div>
            </div>

            {isEditMode &&
            !isFullscreen &&
            filterCtx.combinedFiltersConfig.length > 0 ? (
              <DashboardFilterPanel
                variant="panel"
                filters={filterCtx.combinedFiltersConfig}
                runtimeFilters={filterCtx.runtimeFilters}
                onChange={filterCtx.handleRuntimeFiltersChange}
                fetchOptions={filterCtx.fetchFilterOptions}
                fetchFieldStats={filterCtx.fetchFilterFieldStats}
                minimal={false}
                open={filterCtx.filtersPanelOpen}
                onClose={() => filterCtx.setFiltersPanelOpen(false)}
                onClearAll={() => filterCtx.handleRuntimeFiltersChange([])}
              />
            ) : null}
            </div>
          </main>

          {/* Right toggle button — absolute overlay, does not affect canvas width */}
          {selectedWidgetId && selectedWidget?.chartType !== 'text' && isEditMode && (
            <div
              className={`sidebar-toggle-btn right ${isPropertiesCollapsed ? 'collapsed' : ''}`}
              onClick={() => setPropertiesCollapsed(!isPropertiesCollapsed)}
              style={{
                right: isPropertiesCollapsed ? 0 : '300px',
                zIndex: 60,
              }}
            >
              {isPropertiesCollapsed ? (
                <LeftOutlined style={{ fontSize: '10px' }} />
              ) : (
                <RightOutlined style={{ fontSize: '10px' }} />
              )}
            </div>
          )}

          {/* Right Sidebar Properties — absolute overlay, does NOT push canvas */}
          {sidebarSection === 'modeling' && selectedRelationship ? (
            <RelationshipDetailsPanel
              relationship={selectedRelationship}
              onClose={() => setSelectedRelationship(null)}
            />
          ) : isEditMode ? (
            <PropertiesPanel
              selectedWidget={selectedWidget}
              selectedWidgetId={selectedWidgetId}
              widgets={widgets}
              setWidgets={setWidgets}
              removeWidget={removeWidget}
              isCollapsed={isPropertiesCollapsed || sidebarSection === 'modeling'}
              dashboardPages={filterCtx.pages.map((p) => ({ id: p.id, name: p.name }))}
              globalFiltersConfig={filterCtx.globalFiltersConfig}
              pageFiltersConfig={filterCtx.pageFiltersConfig}
              runtimeFilters={filterCtx.runtimeFilters}
              onRuntimeFiltersChange={filterCtx.handleRuntimeFiltersChange}
            />
          ) : null}
        </div>
      </div>
      <Modal
        title={t('chart_import_title')}
        open={chartImport.importOpen}
        onCancel={chartImport.handleImportCancel}
        onOk={() => void chartImport.handleImportConfirm()}
        okText={t('chart_import_confirm')}
        confirmLoading={chartImport.importing}
      >
        <Select
          style={{ width: '100%' }}
          placeholder={t('chart_import_select_dashboard')}
          value={chartImport.targetDashboardId ?? undefined}
          onChange={chartImport.setTargetDashboardId}
          options={chartImport.dashboardOptions}
        />
      </Modal>
      <CreateDashboardWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        templates={sampleTemplates}
        creating={creatingDashboard}
        onCreateWithLayout={handleWizardCreateWithLayout}
        onCreateFromTemplate={async (template, name) => {
          setCreatingDashboard(true);
          try {
            await createFromTemplate(template, name);
            message.success(t('dashboard_created_success'));
          } catch (err) {
            message.error(formatApiValidationError(err));
          } finally {
            setCreatingDashboard(false);
          }
        }}
      />
    </ConfigProvider>
    </DashboardPageShell>
    </PermissionGuard>
  );
}
