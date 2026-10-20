'use client';

import { ADD_TO_DASHBOARD_EVENT, TRASH_CHART_EVENT } from './chartDesignerEvents';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Input,
  Alert,
  Dropdown,
  Modal,
  Typography,
  message,
  Segmented,
  Button,
  Tooltip,
  Spin,
  Popover,
} from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  DashboardOutlined,
  StarOutlined,
  StarFilled,
  FolderOutlined,
  CopyOutlined,
  LinkOutlined,
  HistoryOutlined,
  AppstoreOutlined,
  UndoOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRouter } from 'next/navigation';
import { useChartDesignerStore } from '../stores/useChartDesignerStore';
import { useDashboardStore } from '../../dashboards/stores/useDashboardStore';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  chartLibraryService,
  type ChartCollection,
  type ChartLibraryFacet,
  type ChartLibraryItem,
} from '../services/chartLibraryService';
import { chartBuilderService } from '../services/chartBuilderService';
import { WidgetBlockPicker } from '../../dashboards/components/WidgetBlockPicker';
import { CollapsedRail, PanelToggle, usePanelCollapsed } from '@/components/layout/SidePanel';
import type { WidgetTemplate } from '../../dashboards/widgetTemplates';
import { DashboardLibrarySelect } from '../../dashboards/components/DashboardLibrarySelect';
import { dashboardLibraryService } from '../../dashboards/services/dashboardLibraryService';
import { CREATE_NEW_DASHBOARD_ID } from '@/hooks/useAddChartToDashboard';
import { LibraryCollectionControls } from '@/components/library/LibraryCollectionControls';
import { getDashboardChartTypeIcon } from '../../dashboards/Properties/dashboardChartTypeSwitcher';
import './ChartDesignerSidebar.css';
import { useTranslations } from 'next-intl';
import { useImpactConfirm } from '@/components/impact/impact';

const { Text } = Typography;

const getChartIcon = (type: string) => getDashboardChartTypeIcon(type);

const PAGE_SIZE = 40;

type ChartDesignerSidebarProps = {
  onAddTemplate?: (template: WidgetTemplate) => void;
};

export const ChartDesignerSidebar: React.FC<ChartDesignerSidebarProps> = ({ onAddTemplate }) => {
  const t = useTranslations('chart_designer');
  const [libraryCollapsed, setLibraryCollapsed] = usePanelCollapsed('designer.library');
  const confirmWithImpact = useImpactConfirm();
  const router = useRouter();
  const {
    widgets,
    selectedWidgetId,
    setSelectedWidgetId,
    deleteChart,
    updateWidget,
    addWidget,
  } = useChartDesignerStore();
  const [addChartOpen, setAddChartOpen] = useState(false);
  const dashboards = useDashboardStore((s) => s.dashboards);
  const fetchDashboards = useDashboardStore((s) => s.fetchDashboards);
  const addDashboard = useDashboardStore((s) => s.addDashboard);
  const linkWidgetToDashboard = useDashboardStore((s) => s.linkWidgetToDashboard);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [facet, setFacet] = useState<ChartLibraryFacet>('all');
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [collections, setCollections] = useState<ChartCollection[]>([]);
  const [items, setItems] = useState<ChartLibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addToDashboardOpen, setAddToDashboardOpen] = useState(false);
  const [addToDashboardChartId, setAddToDashboardChartId] = useState<string | null>(null);
  const [targetDashboardId, setTargetDashboardId] = useState<string | null>(null);
  const [creatingDashboard, setCreatingDashboard] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState('');
  const [pinMode, setPinMode] = useState<'link' | 'copy'>('link');
  const [addingToDashboard, setAddingToDashboard] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const refreshCollections = useCallback(async () => {
    try {
      const rows = await chartLibraryService.listCollections(currentProjectId);
      setCollections(rows);
    } catch (err) {
      console.warn('[ChartDesignerSidebar] collections', err);
    }
  }, [currentProjectId]);

  const loadPage = useCallback(
    async (reset: boolean) => {
      if (reset) {
        setLoading(true);
        offsetRef.current = 0;
      } else {
        setLoadingMore(true);
      }
      try {
        const res = await chartLibraryService.list({
          projectId: currentProjectId,
          q: debouncedSearch || undefined,
          facet,
          collectionId,
          limit: PAGE_SIZE,
          offset: reset ? 0 : offsetRef.current,
          detail: 'summary',
        });
        setItems((prev) => (reset ? res.charts : [...prev, ...res.charts]));
        setTotal(res.total);
        setHasMore(res.hasMore);
        offsetRef.current = (reset ? 0 : offsetRef.current) + res.charts.length;
      } catch (err) {
        console.error('[ChartDesignerSidebar] list', err);
        if (reset) {
          setItems([]);
          setTotal(0);
          setHasMore(false);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [currentProjectId, debouncedSearch, facet, collectionId],
  );

  useEffect(() => {
    void refreshCollections();
  }, [refreshCollections]);

  useEffect(() => {
    if (facet === 'trash' && collectionId) setCollectionId(null);
  }, [facet, collectionId]);

  useEffect(() => {
    void loadPage(true);
  }, [loadPage]);

  // A chart built on the canvas is saved to the library by the store (createChartAndFetchData),
  // but this list was only loaded on mount, so it kept saying "0 charts" (QA F-CHART-01).
  // Reload when a chart id appears that the list hasn't seen.
  const canvasChartIds = widgets
    .map((w) => (w.chartId ? String(w.chartId) : ''))
    .filter(Boolean)
    .sort()
    .join(',');
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    if (!canvasChartIds) return;
    const known = new Set(itemsRef.current.map((it) => String(it.id)));
    if (canvasChartIds.split(',').some((id) => !known.has(id))) void loadPage(true);
  }, [canvasChartIds, loadPage]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 12,
  });

  const ensureWidgetLoaded = useCallback(
    async (chartId: string) => {
      const existing = widgets.find((w) => String(w.chartId) === String(chartId));
      if (existing?.chartQuery && Object.keys(existing.chartQuery).length) {
        setSelectedWidgetId(existing.id);
        void chartLibraryService.touch(chartId).catch(() => undefined);
        return existing.id;
      }
      const full = await chartBuilderService.getChart(chartId);
      const widgetId = `w_saved_${full.id}`;
      const widget = {
        id: widgetId,
        chartId: String(full.id),
        title: String(full.title || t('untitled_short')),
        chartType: String(full.chartType || 'bar'),
        chartQuery: (full.chartQuery as Record<string, unknown>) || {},
        chartOptions: (full.chartOptions as Record<string, unknown>) || {},
        dataSourceId: full.dataSourceId ? String(full.dataSourceId) : undefined,
        isLoading: false,
      };
      if (!widgets.some((w) => w.id === widgetId)) {
        addWidget(widget, { i: widgetId, x: 0, y: 0, w: 12, h: 10 });
      } else {
        updateWidget(widgetId, widget);
      }
      setSelectedWidgetId(widgetId);
      void chartLibraryService.touch(chartId).catch(() => undefined);
      return widgetId;
    },
    [widgets, setSelectedWidgetId, addWidget, updateWidget, t],
  );

  const handleSelect = (chartId: string) => {
    void ensureWidgetLoaded(chartId).catch((err) => {
      console.error(err);
      message.error(t('library_load_failed'));
    });
  };

  const handleRename = (id: string, title: string) => {
    setEditingId(id);
    setEditValue(title);
  };

  const submitRename = async () => {
    if (!editingId || !editValue.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await chartBuilderService.updateChart(editingId, { title: editValue.trim() } as any);
      setItems((prev) =>
        prev.map((it) => (it.id === editingId ? { ...it, title: editValue.trim() } : it)),
      );
      const widget = widgets.find((w) => String(w.chartId) === String(editingId));
      if (widget) updateWidget(widget.id, { title: editValue.trim() });
    } catch (err) {
      console.error(err);
      message.error(t('rename_failed'));
    } finally {
      setEditingId(null);
    }
  };

  const handleDelete = (id: string, title: string) => {
    void confirmWithImpact({
      kind: 'chart',
      id,
      title: t('trash_chart_title'),
      content: t('trash_chart_confirm', { title }),
      okText: t('move_to_trash'),
      danger: true,
      cancelText: t('cancel'),
      onOk: async () => {
        const widget = widgets.find((w) => String(w.chartId) === String(id));
        if (widget) await deleteChart(widget.id);
        else await chartBuilderService.deleteChart(id);
        setItems((prev) => prev.filter((it) => it.id !== id));
        setTotal((n) => Math.max(0, n - 1));
        message.success(t('moved_to_trash'));
      },
    });
  };

  const handleRestore = async (id: string) => {
    try {
      await chartLibraryService.restore(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      setTotal((n) => Math.max(0, n - 1));
      message.success(t('restored'));
    } catch (err) {
      console.error(err);
      message.error(t('restore_failed'));
    }
  };

  const handlePurge = (id: string, title: string) => {
    void confirmWithImpact({
      kind: 'chart',
      id,
      title: t('purge_chart_title'),
      content: t('purge_chart_confirm', { title }),
      okText: t('delete_permanently'),
      danger: true,
      cancelText: t('cancel'),
      onOk: async () => {
        await chartLibraryService.purge(id);
        setItems((prev) => prev.filter((it) => it.id !== id));
        setTotal((n) => Math.max(0, n - 1));
        message.success(t('purged'));
      },
    });
  };

  const toggleFavorite = async (item: ChartLibraryItem) => {
    try {
      const next = await chartLibraryService.setFavorite(item.id, !item.isFavorite);
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, ...next } : it)));
    } catch (err) {
      console.error(err);
    }
  };

  const suggestDashboardName = useCallback(
    (chartId: string) => {
      const fromList = items.find((it) => it.id === chartId)?.title?.trim();
      const fromWidget = widgets.find((w) => String(w.chartId) === String(chartId))?.title?.trim();
      const title = fromList || fromWidget || '';
      if (title) return title.length > 60 ? `${title.slice(0, 57)}…` : title;
      return t('add_to_dashboard_new_default_name');
    },
    [items, t, widgets],
  );

  const openAddToDashboard = async (chartId: string) => {
    let dashboardList = useDashboardStore.getState().dashboards;
    if (dashboardList.length === 0) {
      try {
        const page = await dashboardLibraryService.list({
          projectId: currentProjectId,
          facet: 'recent',
          limit: 1,
          detail: 'summary',
        });
        if (page.total > 0) {
          await fetchDashboards();
          dashboardList = useDashboardStore.getState().dashboards;
        }
      } catch {
        message.error(t('add_to_dashboard_load_failed'));
        return;
      }
    }

    const isEmpty = dashboardList.length === 0;
    setAddToDashboardChartId(chartId);
    setPinMode('link');
    setCreatingDashboard(isEmpty);
    setNewDashboardName(suggestDashboardName(chartId));
    setTargetDashboardId(
      isEmpty
        ? CREATE_NEW_DASHBOARD_ID
        : useDashboardStore.getState().activeDashboardId ?? dashboardList[0]?.id ?? null,
    );
    setAddToDashboardOpen(true);
  };

  const handleDashboardTargetChange = (id: string | null) => {
    if (id === CREATE_NEW_DASHBOARD_ID) {
      setCreatingDashboard(true);
      setTargetDashboardId(CREATE_NEW_DASHBOARD_ID);
      return;
    }
    setCreatingDashboard(false);
    setTargetDashboardId(id);
  };

  // The designer header's "Move to trash" uses this same check and flow.
  useEffect(() => {
    const onTrash = (e: Event) => {
      const d = (e as CustomEvent<{ chartId?: string; title?: string }>).detail;
      if (d?.chartId) handleDelete(d.chartId, d.title || t('untitled_short'));
    };
    window.addEventListener(TRASH_CHART_EVENT, onTrash);
    return () => window.removeEventListener(TRASH_CHART_EVENT, onTrash);
  });

  // The designer header's "Add to dashboard" opens this same dialog.
  useEffect(() => {
    const onRequest = (e: Event) => {
      const chartId = (e as CustomEvent<{ chartId?: string }>).detail?.chartId;
      if (chartId) void openAddToDashboard(chartId);
    };
    window.addEventListener(ADD_TO_DASHBOARD_EVENT, onRequest);
    return () => window.removeEventListener(ADD_TO_DASHBOARD_EVENT, onRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openAddToDashboard reads latest state via the store
  }, [dashboards]);

  const handleAddToDashboard = async () => {
    if (!addToDashboardChartId) return;

    const needsCreate =
      creatingDashboard ||
      targetDashboardId === CREATE_NEW_DASHBOARD_ID ||
      (!targetDashboardId && useDashboardStore.getState().dashboards.length === 0);

    let dashboardId = targetDashboardId;

    if (needsCreate) {
      const name = newDashboardName.trim();
      if (!name) {
        message.warning(t('add_to_dashboard_name_required'));
        return;
      }
    } else if (!dashboardId) {
      message.warning(t('add_to_dashboard_select_required'));
      return;
    }

    setAddingToDashboard(true);
    try {
      if (needsCreate) {
        dashboardId = await addDashboard(newDashboardName.trim());
      }

      await ensureWidgetLoaded(addToDashboardChartId);
      const widget = useChartDesignerStore
        .getState()
        .widgets.find((w) => String(w.chartId) === String(addToDashboardChartId));
      if (!widget?.chartId) throw new Error('Chart not loaded');
      const result = await linkWidgetToDashboard(
        widget as any,
        { i: widget.id, x: 0, y: 0, w: 6, h: 5 },
        dashboardId!,
        pinMode,
      );
      message.success(
        needsCreate
          ? t('add_to_dashboard_created_and_added')
          : pinMode === 'copy'
            ? t('add_to_dashboard_copied')
            : t('add_to_dashboard_linked'),
      );
      setAddToDashboardOpen(false);
      setCreatingDashboard(false);
      setNewDashboardName('');
      router.push(`/dashboards?id=${dashboardId}&chart=${result.chartId}&mode=edit`);
    } catch (err) {
      console.error('[ChartDesignerSidebar] add to dashboard', err);
      message.error(t('add_to_dashboard_failed'));
    } finally {
      setAddingToDashboard(false);
    }
  };

  const moveToCollection = async (chartId: string, nextCollectionId: string | null) => {
    try {
      await chartLibraryService.assignCollection(chartId, nextCollectionId);
      setItems((prev) =>
        prev.map((it) => (it.id === chartId ? { ...it, collectionId: nextCollectionId } : it)),
      );
      if (collectionId && nextCollectionId !== collectionId) {
        setItems((prev) => prev.filter((it) => it.id !== chartId));
      }
    } catch (err) {
      console.error(err);
      message.error(t('collection_move_failed'));
    }
  };

  const handleAddTemplate = (template: WidgetTemplate) => {
    onAddTemplate?.(template);
    setAddChartOpen(false);
  };

  const selectedChartId = useMemo(() => {
    const w = widgets.find((x) => x.id === selectedWidgetId);
    return w?.chartId ? String(w.chartId) : null;
  }, [widgets, selectedWidgetId]);

  const facetOptions = useMemo(
    () => [
      {
        value: 'all',
        label: (
          <span className="library-facet-label" title={t('facet_all')}>
            {t('facet_all')}
          </span>
        ),
      },
      {
        value: 'recent',
        label: (
          <span className="library-facet-label" title={t('facet_recent')} aria-label={t('facet_recent')}>
            <HistoryOutlined />
          </span>
        ),
      },
      {
        value: 'library',
        label: (
          <span className="library-facet-label" title={t('facet_library')} aria-label={t('facet_library')}>
            <AppstoreOutlined />
          </span>
        ),
      },
      {
        value: 'on_dashboards',
        label: (
          <span className="library-facet-label" title={t('facet_used')} aria-label={t('facet_used')}>
            <DashboardOutlined />
          </span>
        ),
      },
      {
        value: 'favorites',
        label: (
          <span className="library-facet-label" title={t('facet_favorites_label')} aria-label={t('facet_favorites_label')}>
            <StarOutlined />
          </span>
        ),
      },
      {
        value: 'trash',
        label: (
          <span className="library-facet-label" title={t('facet_trash')} aria-label={t('facet_trash')}>
            <DeleteOutlined />
          </span>
        ),
      },
    ],
    [t],
  );

  if (libraryCollapsed) {
    return (
      <aside className="chart-designer-sidebar chart-designer-sidebar--rail">
        <CollapsedRail side="left" label={t('library_title')} icon={<BarChartOutlined />} count={widgets.length} onExpand={() => setLibraryCollapsed(false)} />
      </aside>
    );
  }

  return (
    <aside className="chart-designer-sidebar">
      <div className="sidebar-header">
        <Input
          prefix={<SearchOutlined />}
          placeholder={t('search_placeholder_short')}
          variant="borderless"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
        <PanelToggle side="left" collapsed={false} onToggle={() => setLibraryCollapsed(true)} label={t('library_title')} />
      </div>

      <div className="library-toolbar">
        <Segmented
          size="small"
          block
          className="library-facets"
          value={facet}
          onChange={(v) => setFacet(v as ChartLibraryFacet)}
          options={facetOptions}
        />
        {facet === 'trash' ? (
          <div className="library-toolbar-extra" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Popover
              trigger="click"
              placement="bottomRight"
              open={addChartOpen}
              onOpenChange={setAddChartOpen}
              content={
                <div style={{ width: 340, maxHeight: 420, overflow: 'auto', padding: 4 }}>
                  <WidgetBlockPicker
                    variant="popover"
                    chartsOnly
                    onSelect={handleAddTemplate}
                    hintText={t('empty_state_hint')}
                  />
                </div>
              }
            >
              <Tooltip title={t('add_chart')}>
                <Button size="small" type="primary" icon={<PlusOutlined />} />
              </Tooltip>
            </Popover>
          </div>
        ) : (
          <LibraryCollectionControls
            collections={collections.map((c) => ({ id: c.id, name: c.name }))}
            value={collectionId}
            onChange={setCollectionId}
            onCollectionsChange={(next) =>
              setCollections(next.map((c) => ({ id: c.id, name: c.name } as ChartCollection)))
            }
            createCollection={async (name) => {
              const created = await chartLibraryService.createCollection(name, currentProjectId);
              return { id: created.id, name: created.name };
            }}
            renameCollection={async (id, name) => {
              const updated = await chartLibraryService.renameCollection(id, name, currentProjectId);
              return { id: updated.id, name: updated.name };
            }}
            deleteCollection={async (id) => {
              await chartLibraryService.deleteCollection(id, currentProjectId);
              await loadPage(true);
            }}
            labels={{
              allCollections: t('all_collections'),
              newCollection: t('new_collection'),
              renameCollection: t('rename_collection'),
              deleteCollection: t('delete_collection'),
              deleteConfirmTitle: t.raw('delete_collection_title'),
              deleteConfirmBody: t('delete_collection_body'),
              create: t('create'),
              save: t('save'),
              namePlaceholder: t('collection_name_placeholder'),
              created: t('collection_created'),
              renamed: t('collection_renamed'),
              deleted: t('collection_deleted'),
              manageCollection: t('manage_collection'),
              manageCollections: t('manage_collections'),
              noCollections: t('no_collections_yet'),
              filterByCollection: t('filter_by_collection'),
            }}
            extra={
              <Popover
                trigger="click"
                placement="bottomRight"
                open={addChartOpen}
                onOpenChange={setAddChartOpen}
                content={
                  <div style={{ width: 340, maxHeight: 420, overflow: 'auto', padding: 4 }}>
                    <WidgetBlockPicker
                      variant="popover"
                      chartsOnly
                      onSelect={handleAddTemplate}
                      hintText={t('empty_state_hint')}
                    />
                  </div>
                }
              >
                <Tooltip title={t('add_chart')}>
                  <Button size="small" type="primary" icon={<PlusOutlined />} />
                </Tooltip>
              </Popover>
            }
          />
        )}
        <div className="library-count">{t('library_count', { count: total })}</div>
      </div>

      <div className="sidebar-nav library-scroll" ref={parentRef}>
        {loading ? (
          <div className="empty-sidebar-state">
            <Spin size="small" />
          </div>
        ) : items.length === 0 ? (
          <div className="empty-sidebar-state">
            <Text type="secondary" style={{ fontSize: '12px' }}>
              {debouncedSearch ? t('empty_no_charts_search') : t('empty_no_charts')}
            </Text>
          </div>
        ) : (
          <div
            className="nav-items-list virtual-list"
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;
              const usage = item.usageCount || 0;
              return (
                <div
                  key={item.id}
                  className={`nav-item ${selectedChartId === item.id ? 'active' : ''}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => handleSelect(item.id)}
                >
                  <div className="item-icon">{getChartIcon(item.chartType)}</div>
                  <div className="item-content">
                    {editingId === item.id ? (
                      <Input
                        size="small"
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => void submitRename()}
                        onPressEnter={() => void submitRename()}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span className="item-name">{item.title || t('untitled_short')}</span>
                        <span className="item-meta">
                          {item.dataTable ? `${item.dataTable} · ` : ''}
                          {usage > 0
                            ? t('used_on_n', { count: usage })
                            : t('scope_library')}
                        </span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className="fav-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleFavorite(item);
                    }}
                  >
                    {item.isFavorite ? <StarFilled /> : <StarOutlined />}
                  </button>
                  <Dropdown
                    menu={{
                      items:
                        facet === 'trash'
                          ? [
                              {
                                key: 'restore',
                                icon: <UndoOutlined />,
                                label: t('restore'),
                                onClick: () => void handleRestore(item.id),
                              },
                              {
                                key: 'purge',
                                icon: <DeleteOutlined />,
                                label: t('delete_permanently'),
                                danger: true,
                                onClick: () =>
                                  handlePurge(item.id, item.title || t('untitled_short')),
                              },
                            ]
                          : [
                              {
                                key: 'rename',
                                icon: <EditOutlined />,
                                label: t('rename'),
                                onClick: () => handleRename(item.id, item.title || ''),
                              },
                              {
                                key: 'add-to-dashboard',
                                icon: <DashboardOutlined />,
                                label: t('add_to_dashboard'),
                                onClick: () => void openAddToDashboard(item.id),
                              },
                              {
                                key: 'move',
                                icon: <FolderOutlined />,
                                label: t('move_to_collection'),
                                children: [
                                  {
                                    key: 'root',
                                    label: t('unassigned'),
                                    onClick: () => void moveToCollection(item.id, null),
                                  },
                                  ...collections.map((c) => ({
                                    key: c.id,
                                    label: c.name,
                                    onClick: () => void moveToCollection(item.id, c.id),
                                  })),
                                ],
                              },
                              {
                                key: 'delete',
                                icon: <DeleteOutlined />,
                                label: t('move_to_trash'),
                                danger: true,
                                onClick: () =>
                                  handleDelete(item.id, item.title || t('untitled_short')),
                              },
                            ],
                      onClick: (e) => e.domEvent.stopPropagation(),
                    }}
                    trigger={['click']}
                    placement="bottomRight"
                  >
                    <div className="item-actions" onClick={(e) => e.stopPropagation()}>
                      <MoreOutlined />
                    </div>
                  </Dropdown>
                </div>
              );
            })}
          </div>
        )}

        {hasMore && (
          <Button
            size="small"
            type="link"
            loading={loadingMore}
            onClick={() => void loadPage(false)}
            style={{ marginTop: 8 }}
          >
            {t('load_more')}
          </Button>
        )}
      </div>

      <Modal
        title={t('add_to_dashboard')}
        open={addToDashboardOpen}
        onCancel={() => {
          setAddToDashboardOpen(false);
          setCreatingDashboard(false);
          setNewDashboardName('');
        }}
        onOk={() => void handleAddToDashboard()}
        okText={
          creatingDashboard || targetDashboardId === CREATE_NEW_DASHBOARD_ID
            ? t('add_to_dashboard_create_and_add')
            : pinMode === 'copy'
              ? t('add_as_copy')
              : t('add_as_link')
        }
        confirmLoading={addingToDashboard}
      >
        {creatingDashboard && !dashboards.length ? (
          <Alert
            type="info"
            showIcon
            message={t('add_to_dashboard_no_dashboards')}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {!(creatingDashboard && !dashboards.length) ? (
          <DashboardLibrarySelect
            value={
              targetDashboardId === CREATE_NEW_DASHBOARD_ID ? CREATE_NEW_DASHBOARD_ID : targetDashboardId
            }
            onChange={handleDashboardTargetChange}
            placeholder={t('add_to_dashboard_select')}
            defaultFacet="recent"
            style={{ marginBottom: 12 }}
            extraOptions={[{ value: CREATE_NEW_DASHBOARD_ID, label: t('add_to_dashboard_create_new') }]}
          />
        ) : null}
        {creatingDashboard || targetDashboardId === CREATE_NEW_DASHBOARD_ID ? (
          <Input
            placeholder={t('add_to_dashboard_name_placeholder')}
            value={newDashboardName}
            onChange={(e) => setNewDashboardName(e.target.value)}
            maxLength={120}
            showCount
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Segmented
          block
          value={pinMode}
          onChange={(v) => setPinMode(v as 'link' | 'copy')}
          options={[
            {
              label: (
                <span>
                  <LinkOutlined /> {t('pin_mode_link')}
                </span>
              ),
              value: 'link',
            },
            {
              label: (
                <span>
                  <CopyOutlined /> {t('pin_mode_copy')}
                </span>
              ),
              value: 'copy',
            },
          ]}
        />
        <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          {pinMode === 'link' ? t('pin_mode_link_hint') : t('pin_mode_copy_hint')}
        </Text>
      </Modal>
    </aside>
  );
};
