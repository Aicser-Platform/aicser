'use client';

/**
 * Dashboard library navigator — mirrors Chart Designer sidebar:
 * facets, collections, server search, infinite load. Single source of truth.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Collapse,
  Dropdown,
  Empty,
  Input,
  Modal,
  Segmented,
  Spin,
  Tooltip,
  message,
} from 'antd';
import {
  CopyOutlined,
  DashboardOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  HistoryOutlined,
  InboxOutlined,
  MoreOutlined,
  PlusOutlined,
  RobotOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { getChatHref } from '@/utils/appPaths';
import { useProjectStore } from '@/stores/useProjectStore';
import { chartService, type DashboardTemplate } from '../../../services/chartService';
import { useDashboardStore } from '../../../stores/useDashboardStore';
import {
  dashboardLibraryService,
  type DashboardCollection,
  type DashboardLibraryFacet,
  type DashboardLibraryItem,
} from '../../../services/dashboardLibraryService';
import { formatApiValidationError } from '@/utils/validationErrorMessage';
import { LibraryCollectionControls } from '@/components/library/LibraryCollectionControls';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

export function DashboardsSection() {
  const t = useTranslations('dashboard_tabs');
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const setActiveDashboardId = useDashboardStore((s) => s.setActiveDashboardId);
  const loadDashboardById = useDashboardStore((s) => s.loadDashboardById);
  const addDashboard = useDashboardStore((s) => s.addDashboard);
  const duplicateDashboard = useDashboardStore((s) => s.duplicateDashboard);
  const removeDashboard = useDashboardStore((s) => s.removeDashboard);
  const updateDashboardName = useDashboardStore((s) => s.updateDashboardName);
  const fetchDashboards = useDashboardStore((s) => s.fetchDashboards);
  const toggleStarDashboard = useDashboardStore((s) => s.toggleStarDashboard);
  const starredDashboardIds = useDashboardStore((s) => s.starredDashboardIds);
  const { currentProjectId } = useProjectStore();

  const [facet, setFacet] = useState<DashboardLibraryFacet>('all');
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [collections, setCollections] = useState<DashboardCollection[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [items, setItems] = useState<DashboardLibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [templates, setTemplates] = useState<DashboardTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadCollections = useCallback(async () => {
    try {
      const rows = await dashboardLibraryService.listCollections(currentProjectId);
      setCollections(rows);
    } catch {
      setCollections([]);
    }
  }, [currentProjectId]);

  const loadPage = useCallback(
    async (reset: boolean) => {
      if (reset) setLoading(true);
      else setLoadingMore(true);
      try {
        const nextOffset = reset ? 0 : offsetRef.current;
        const page = await dashboardLibraryService.list({
          projectId: currentProjectId,
          q: debouncedSearch || undefined,
          facet,
          collectionId,
          limit: 40,
          offset: nextOffset,
          detail: 'summary',
        });
        setItems((prev) => (reset ? page.dashboards : [...prev, ...page.dashboards]));
        setTotal(page.total);
        const advanced = page.offset + page.dashboards.length;
        offsetRef.current = advanced;
        setHasMore(page.hasMore);
        // Keep store stars in sync for toolbar
        const favIds = page.dashboards.filter((d) => d.isFavorite).map((d) => String(d.id));
        if (reset && favIds.length) {
          useDashboardStore.setState((state) => {
            const next = new Set(state.starredDashboardIds);
            favIds.forEach((id) => next.add(id));
            return { starredDashboardIds: next };
          });
        }
      } catch (err) {
        console.error('[DashboardsSection] load failed', err);
        if (reset) {
          setItems([]);
          setTotal(0);
          offsetRef.current = 0;
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [currentProjectId, debouncedSearch, facet, collectionId],
  );

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    void loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, debouncedSearch, facet, collectionId]);

  useEffect(() => {
    if (facet === 'trash' && collectionId) setCollectionId(null);
  }, [facet, collectionId]);

  useEffect(() => {
    let cancelled = false;
    const loadTemplates = async () => {
      setIsLoadingTemplates(true);
      try {
        const nextTemplates = await chartService.getDashboardTemplates();
        if (!cancelled) setTemplates(nextTemplates);
      } catch {
        if (!cancelled) setTemplates([]);
      } finally {
        if (!cancelled) setIsLoadingTemplates(false);
      }
    };
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  const facetOptions = useMemo(
    () => [
      {
        value: 'all',
        label: (
          <span className="dashboard-drawer-facet-label" title={t('facet_all')}>
            {t('facet_all')}
          </span>
        ),
      },
      {
        value: 'recent',
        label: (
          <span className="dashboard-drawer-facet-label" title={t('facet_recent')} aria-label={t('facet_recent')}>
            <HistoryOutlined />
          </span>
        ),
      },
      {
        value: 'favorites',
        label: (
          <span
            className="dashboard-drawer-facet-label"
            title={t('facet_favorites_label')}
            aria-label={t('facet_favorites_label')}
          >
            <StarOutlined />
          </span>
        ),
      },
      {
        value: 'unfiled',
        label: (
          <span className="dashboard-drawer-facet-label" title={t('facet_unfiled')} aria-label={t('facet_unfiled')}>
            <InboxOutlined />
          </span>
        ),
      },
      {
        value: 'trash',
        label: (
          <span className="dashboard-drawer-facet-label" title={t('facet_trash')} aria-label={t('facet_trash')}>
            <DeleteOutlined />
          </span>
        ),
      },
    ],
    [t],
  );

  const handleSelect = async (id: string) => {
    setActiveDashboardId(id);
    await loadDashboardById(id);
    try {
      await dashboardLibraryService.touch(id);
    } catch {
      /* optional */
    }
  };

  const handleCreate = async () => {
    try {
      await addDashboard();
      await loadPage(true);
      await fetchDashboards();
      message.success(t('new_dashboard'));
    } catch (error) {
      message.error(formatApiValidationError(error));
    }
  };

  const handleCreateFromTemplate = async (template: DashboardTemplate) => {
    if (isEnterpriseEdition && !currentProjectId) {
      message.warning(t('select_project_first'));
      return;
    }
    setCreatingTemplateId(template.id);
    try {
      const result = await chartService.createDashboardFromTemplate({
        templateId: template.id,
        projectId: isEnterpriseEdition ? String(currentProjectId) : undefined,
        dashboardName: template.default_dashboard_name,
      });
      await fetchDashboards();
      await loadPage(true);
      const createdId = result?.dashboard?.id;
      if (createdId) {
        setActiveDashboardId(String(createdId));
        await loadDashboardById(String(createdId));
      }
      message.success(
        t('template_created', {
          title: result?.dashboard?.title || template.default_dashboard_name || template.name,
        }),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('template_create_failed'));
    } finally {
      setCreatingTemplateId(null);
    }
  };

  const beginRename = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const commitRename = async () => {
    if (!editingId) return;
    const nextName = editingName.trim();
    if (!nextName) {
      setEditingId(null);
      return;
    }
    try {
      await updateDashboardName(editingId, nextName);
      setItems((prev) =>
        prev.map((d) => (String(d.id) === editingId ? { ...d, title: nextName, name: nextName } : d)),
      );
      message.success(t('dashboard_renamed'));
    } catch {
      message.error(t('failed_rename_dashboard'));
    } finally {
      setEditingId(null);
    }
  };

  const confirmRemove = (id: string, name: string) => {
    Modal.confirm({
      title: t('trash_dashboard_title'),
      content: t('trash_dashboard_confirm', { name }),
      okText: t('move_to_trash'),
      okType: 'danger',
      onOk: async () => {
        try {
          await removeDashboard(id);
          setItems((prev) => prev.filter((d) => String(d.id) !== String(id)));
          setTotal((n) => Math.max(0, n - 1));
          message.success(t('moved_to_trash'));
        } catch {
          message.error(t('failed_remove_dashboard'));
        }
      },
    });
  };

  const handleRestore = async (id: string) => {
    try {
      await dashboardLibraryService.restore(id);
      setItems((prev) => prev.filter((d) => String(d.id) !== String(id)));
      setTotal((n) => Math.max(0, n - 1));
      message.success(t('restored'));
      await fetchDashboards();
    } catch {
      message.error(t('restore_failed'));
    }
  };

  const handlePurge = (id: string, name: string) => {
    Modal.confirm({
      title: t('purge_dashboard_title'),
      content: t('purge_dashboard_confirm', { name }),
      okText: t('delete_permanently'),
      okType: 'danger',
      onOk: async () => {
        try {
          await dashboardLibraryService.purge(id);
          setItems((prev) => prev.filter((d) => String(d.id) !== String(id)));
          setTotal((n) => Math.max(0, n - 1));
          message.success(t('purged'));
          await fetchDashboards();
        } catch {
          message.error(t('failed_remove_dashboard'));
        }
      },
    });
  };

  const moveToCollection = async (dashboardId: string, nextCollectionId: string | null) => {
    try {
      await dashboardLibraryService.assignCollection(dashboardId, nextCollectionId);
      if (collectionId && nextCollectionId !== collectionId) {
        setItems((prev) => prev.filter((d) => String(d.id) !== String(dashboardId)));
      } else {
        setItems((prev) =>
          prev.map((d) =>
            String(d.id) === String(dashboardId) ? { ...d, collectionId: nextCollectionId } : d,
          ),
        );
      }
    } catch (err) {
      message.error(formatApiValidationError(err));
    }
  };

  const renderDashboardRow = (dashboard: DashboardLibraryItem) => {
    const id = String(dashboard.id);
    const name = dashboard.title || dashboard.name || id;
    const isActive = id === activeDashboardId;
    const isStarred = starredDashboardIds.has(id) || Boolean(dashboard.isFavorite);
    const actionItems =
      facet === 'trash'
        ? [
            {
              key: 'restore',
              icon: <UndoOutlined />,
              label: t('restore'),
              onClick: () => void handleRestore(id),
            },
            {
              key: 'purge',
              icon: <DeleteOutlined />,
              label: t('delete_permanently'),
              danger: true,
              onClick: () => handlePurge(id, name),
            },
          ]
        : [
            {
              key: 'rename',
              icon: <EditOutlined />,
              label: t('rename'),
              onClick: () => beginRename(id, name),
            },
            {
              key: 'duplicate',
              icon: <CopyOutlined />,
              label: t('duplicate'),
              onClick: async () => {
                try {
                  await duplicateDashboard(id);
                  await loadPage(true);
                  message.success(t('dashboard_duplicated'));
                } catch {
                  message.error(t('dashboard_duplicate_failed'));
                }
              },
            },
            {
              key: 'move',
              icon: <FolderOutlined />,
              label: t('move_to_folder'),
              children: [
                {
                  key: 'unfiled',
                  label: t('unassigned'),
                  onClick: () => void moveToCollection(id, null),
                },
                ...collections.map((c) => ({
                  key: c.id,
                  label: c.name,
                  onClick: () => void moveToCollection(id, c.id),
                })),
              ],
            },
            {
              key: 'delete',
              icon: <DeleteOutlined />,
              label: t('move_to_trash'),
              danger: true,
              onClick: () => confirmRemove(id, name),
            },
          ];

    return (
      <div
        key={id}
        className={`dashboard-drawer-row${isActive ? ' active' : ''}`}
        onClick={() => void handleSelect(id)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void handleSelect(id);
          }
        }}
      >
        <DashboardOutlined className="dashboard-drawer-row-icon" />
        {editingId === id ? (
          <Input
            size="small"
            value={editingName}
            autoFocus
            onChange={(event) => setEditingName(event.target.value)}
            onBlur={() => void commitRename()}
            onPressEnter={() => void commitRename()}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <div className="dashboard-drawer-row-main" title={name}>
            <span className="dashboard-drawer-row-title">{name}</span>
            {typeof dashboard.chartCount === 'number' ? (
              <span className="dashboard-drawer-row-meta">
                {t('charts_count', { count: dashboard.chartCount })}
              </span>
            ) : null}
          </div>
        )}
        <div className="dashboard-drawer-row-actions" onClick={(event) => event.stopPropagation()}>
          <Tooltip title={t('star_toggle')}>
            <Button
              type="text"
              size="small"
              icon={isStarred ? <StarFilled /> : <StarOutlined />}
              aria-label={t('star_toggle')}
              onClick={() => {
                toggleStarDashboard(id);
                setItems((prev) =>
                  prev.map((d) =>
                    String(d.id) === id ? { ...d, isFavorite: !isStarred } : d,
                  ),
                );
              }}
            />
          </Tooltip>
          <Dropdown menu={{ items: actionItems }} trigger={['click']}>
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined />}
              aria-label={t('more_dashboard_actions')}
            />
          </Dropdown>
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard-drawer">
      <div className="dashboard-drawer-actions">
        <Button type="primary" block icon={<PlusOutlined />} onClick={() => void handleCreate()}>
          {t('new_dashboard')}
        </Button>
        {isEnterpriseEdition ? (
          <Link href={getChatHref({ mode: 'dashboard' })}>
            <Button block icon={<RobotOutlined />} className="dashboard-drawer-create-ai">
              {t('new_dashboard_with_ai')}
            </Button>
          </Link>
        ) : null}
      </div>

      <div className="dashboard-drawer-toolbar">
        <div className="dashboard-drawer-search">
          <Input
            allowClear
            placeholder={t('search_dashboards')}
            prefix={<SearchOutlined />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <Segmented
          size="small"
          block
          className="dashboard-drawer-facets"
          value={facet}
          onChange={(v) => setFacet(v as DashboardLibraryFacet)}
          options={facetOptions}
        />

        {facet !== 'trash' ? (
          <LibraryCollectionControls
            className="dashboard-drawer-collection-row"
            collections={collections.map((c) => ({ id: c.id, name: c.name }))}
            value={collectionId}
            onChange={setCollectionId}
            onCollectionsChange={(next) =>
              setCollections(next.map((c) => ({ id: c.id, name: c.name } as DashboardCollection)))
            }
            createCollection={async (name) => {
              const created = await dashboardLibraryService.createCollection(name, currentProjectId);
              return { id: created.id, name: created.name };
            }}
            renameCollection={async (id, name) => {
              const updated = await dashboardLibraryService.renameCollection(id, name, currentProjectId);
              return { id: updated.id, name: updated.name };
            }}
            deleteCollection={async (id) => {
              await dashboardLibraryService.deleteCollection(id, currentProjectId);
              await loadPage(true);
            }}
            labels={{
              allCollections: t('all_collections'),
              newCollection: t('new_folder'),
              renameCollection: t('rename_folder'),
              deleteCollection: t('delete_folder'),
              deleteConfirmTitle: t('delete_folder_title'),
              deleteConfirmBody: t('delete_folder_body'),
              create: t('create_collection'),
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
          />
        ) : null}

        <div className="dashboard-drawer-count">{t('library_count', { count: total })}</div>
      </div>

      <div className="dashboard-drawer-list">
        {loading ? (
          <div className="dashboard-drawer-loading">
            <Spin size="small" />
            <span>{t('loading_dashboards')}</span>
          </div>
        ) : items.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={debouncedSearch ? t('no_dashboards_found') : t('no_dashboards_yet')}
            className="dashboard-drawer-empty"
          />
        ) : (
          <>
            {items.map(renderDashboardRow)}
            {hasMore ? (
              <Button
                type="link"
                size="small"
                className="dashboard-drawer-load-more"
                loading={loadingMore}
                onClick={() => void loadPage(false)}
              >
                {t('load_more')}
              </Button>
            ) : null}
          </>
        )}
      </div>

      <Collapse
        ghost
        size="small"
        className="dashboard-drawer-templates"
        items={[
          {
            key: 'templates',
            label: t('sample_dashboards'),
            children: isLoadingTemplates ? (
              <div className="dashboard-drawer-loading compact">
                <Spin size="small" />
                <span>{t('loading_templates')}</span>
              </div>
            ) : templates.length === 0 ? (
              <div className="dashboard-drawer-muted">{t('templates_load_failed')}</div>
            ) : (
              <div className="dashboard-template-list">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="dashboard-template-row"
                    disabled={!!creatingTemplateId}
                    onClick={() => void handleCreateFromTemplate(template)}
                  >
                    <span>{template.name}</span>
                    <small>{template.category}</small>
                  </button>
                ))}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
