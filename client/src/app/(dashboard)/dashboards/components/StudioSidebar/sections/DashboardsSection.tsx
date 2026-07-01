'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Collapse,
  Dropdown,
  Empty,
  Input,
  Modal,
  Spin,
  Tooltip,
  message,
} from 'antd';
import {
  CopyOutlined,
  DashboardOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  RobotOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { getChatHref } from '@/utils/appPaths';
import { useProjectStore } from '@/stores/useProjectStore';
import { chartService, type DashboardTemplate } from '../../../services/chartService';
import { useDashboardStore } from '../../../stores/useDashboardStore';
import { formatApiValidationError } from '@/utils/validationErrorMessage';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

export function DashboardsSection() {
  const t = useTranslations('dashboard_tabs');
  const dashboards = useDashboardStore((s) => s.dashboards);
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const isLoadingDashboards = useDashboardStore((s) => s.isLoadingDashboards);
  const setActiveDashboardId = useDashboardStore((s) => s.setActiveDashboardId);
  const loadDashboardById = useDashboardStore((s) => s.loadDashboardById);
  const addDashboard = useDashboardStore((s) => s.addDashboard);
  const duplicateDashboard = useDashboardStore((s) => s.duplicateDashboard);
  const removeDashboard = useDashboardStore((s) => s.removeDashboard);
  const updateDashboardName = useDashboardStore((s) => s.updateDashboardName);
  const fetchDashboards = useDashboardStore((s) => s.fetchDashboards);
  const starredDashboardIds = useDashboardStore((s) => s.starredDashboardIds);
  const toggleStarDashboard = useDashboardStore((s) => s.toggleStarDashboard);
  const { currentProjectId } = useProjectStore();

  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [templates, setTemplates] = useState<DashboardTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);

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

  const filtered = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();
    const sorted = [...dashboards].sort((a, b) => {
      const aStarred = starredDashboardIds.has(a.id) ? 1 : 0;
      const bStarred = starredDashboardIds.has(b.id) ? 1 : 0;
      if (aStarred !== bStarred) return bStarred - aStarred;
      return a.name.localeCompare(b.name);
    });
    if (!cleanSearch) return sorted;
    return sorted.filter((dashboard) => dashboard.name.toLowerCase().includes(cleanSearch));
  }, [dashboards, search, starredDashboardIds]);

  const handleSelect = async (id: string) => {
    setActiveDashboardId(id);
    await loadDashboardById(id);
  };

  const handleCreate = async () => {
    try {
      await addDashboard();
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
      const createdId = result?.dashboard?.id;
      if (createdId) setActiveDashboardId(String(createdId));
      message.success(t('template_created', {
        title: result?.dashboard?.title || template.default_dashboard_name || template.name,
      }));
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
      message.success(t('dashboard_renamed'));
    } catch {
      message.error(t('failed_rename_dashboard'));
    } finally {
      setEditingId(null);
    }
  };

  const confirmRemove = (id: string, name: string) => {
    Modal.confirm({
      title: t('remove_dashboard_confirm_title'),
      content: t('remove_dashboard_confirm_body', { name }),
      okText: t('remove'),
      okType: 'danger',
      onOk: async () => {
        try {
          await removeDashboard(id);
          message.success(t('dashboard_removed'));
        } catch {
          message.error(t('failed_remove_dashboard'));
        }
      },
    });
  };

  const renderDashboardRow = (dashboard: { id: string; name: string }) => {
    const isActive = dashboard.id === activeDashboardId;
    const isStarred = starredDashboardIds.has(dashboard.id);
    const actionItems = [
      {
        key: 'rename',
        icon: <EditOutlined />,
        label: t('rename'),
        onClick: () => beginRename(dashboard.id, dashboard.name),
      },
      {
        key: 'duplicate',
        icon: <CopyOutlined />,
        label: t('duplicate'),
        onClick: async () => {
          try {
            await duplicateDashboard(dashboard.id);
            message.success(t('dashboard_duplicated'));
          } catch {
            message.error(t('dashboard_duplicate_failed'));
          }
        },
      },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: t('remove'),
        danger: true,
        onClick: () => confirmRemove(dashboard.id, dashboard.name),
      },
    ];

    return (
      <div
        key={dashboard.id}
        className={`dashboard-drawer-row${isActive ? ' active' : ''}`}
        onClick={() => void handleSelect(dashboard.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void handleSelect(dashboard.id);
          }
        }}
      >
        <DashboardOutlined className="dashboard-drawer-row-icon" />
        {editingId === dashboard.id ? (
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
          <span className="dashboard-drawer-row-title" title={dashboard.name}>
            {dashboard.name}
          </span>
        )}
        <div className="dashboard-drawer-row-actions" onClick={(event) => event.stopPropagation()}>
          <Tooltip title={t('star_toggle')}>
            <Button
              type="text"
              size="small"
              icon={isStarred ? <StarFilled /> : <StarOutlined />}
              aria-label={t('star_toggle')}
              onClick={() => toggleStarDashboard(dashboard.id)}
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
        <Button block icon={<PlusOutlined />} onClick={() => void handleCreate()}>
          {t('new_dashboard')}
        </Button>
        {isEnterpriseEdition ? (
          <Link href={getChatHref({ mode: 'dashboard' })}>
            <Button block icon={<RobotOutlined />}>
              {t('new_dashboard_with_ai')}
            </Button>
          </Link>
        ) : null}
      </div>

      <div className="dashboard-drawer-search">
        <Input
          size="small"
          placeholder={t('search_dashboards')}
          prefix={<SearchOutlined />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
        />
      </div>

      <div className="dashboard-drawer-section-label">{t('my_dashboards')}</div>
      <div className="dashboard-drawer-list">
        {isLoadingDashboards ? (
          <div className="dashboard-drawer-loading">
            <Spin size="small" />
            <span>{t('loading_dashboards')}</span>
          </div>
        ) : filtered.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={search.trim() ? t('no_dashboards_found') : t('no_dashboards_yet')}
            className="dashboard-drawer-empty"
          />
        ) : (
          filtered.map(renderDashboardRow)
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
