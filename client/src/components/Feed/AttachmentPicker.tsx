'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Input, List, Button, Empty, Spin, Tag, Tabs, Typography, message } from 'antd';
import {
  BulbOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  DashboardOutlined,
  LineChartOutlined,
  LockOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useDashboards, useCharts } from '@/hooks/useDashboards';
import { useProjects } from '@/hooks/useProjects';
import { useProjectStore } from '@/stores/useProjectStore';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { listCharts, type Chart, type Dashboard } from '@/api/dashboards';
import {
  socialFeedService,
  type AttachmentRef,
  type FeedItem,
  type FeedScope,
} from '@/services/socialFeedService';
import { buildDashboardAttachmentSnapshot, buildChartAttachmentSnapshot } from './buildAttachmentSnapshot';

const { Text } = Typography;

export interface PickedAttachment extends AttachmentRef {
  title: string;
  /** Captured once, here, at pick time (reusing the exact same fetch +
   * snapshot-build logic the normal "Publish to Feed" flow already uses) so
   * every later viewer gets a cheap static read instead of a fresh live
   * query - see buildAttachmentSnapshot.ts. Null if capture failed or the
   * dashboard/chart has no charts yet; the attachment still works, just
   * renders live instead of from a snapshot. */
  snapshot_payload?: Record<string, unknown> | null;
}

interface AttachmentPickerProps {
  open: boolean;
  /** Already-picked attachments, excluded from the list so the same item can't be added twice. */
  excludeIds: string[];
  /** For cross-referencing each dashboard's project visibility (see the private-project hint below). */
  organizationId?: string;
  onPick: (attachment: PickedAttachment) => void;
  onClose: () => void;
}

type PickerTab = 'dashboards' | 'charts' | 'published';

type CatalogChart = Chart & { dashboardTitle: string };

/**
 * Pick an existing dashboard, a chart within one, or an already-published
 * feed post (insight / chart / dashboard) to attach to a new post.
 *
 * Dashboards: union of the active project's library AND dashboards the
 * author owns across projects. Passing no project_id to the EE list API
 * falls back to created_by == me, which hid project dashboards teammates
 * (or the AI) created; passing only the active project hid other projects
 * the author actually owns.
 *
 * Charts: flattened from those dashboards via GET dashboards/{id}/charts
 * (dashboard_charts placements), the same source the live dashboards app uses.
 *
 * Published: the author's own feed posts, captured with the same snapshot
 * payload Publish to Feed already stored so attach-from-feed matches
 * share-to-feed.
 */
export function AttachmentPicker({ open, excludeIds, organizationId, onPick, onClose }: AttachmentPickerProps) {
  const t = useTranslations('feed_page');
  const { user } = useAuth();
  const currentProjectId = useProjectStore((s) => s.currentProject?.id);
  const projectId = currentProjectId != null ? String(currentProjectId) : undefined;
  const { dashboards: ownedDashboards, isLoading: ownedLoading } = useDashboards();
  const { dashboards: projectDashboards, isLoading: projectLoading } = useDashboards(projectId);
  const { projects } = useProjects(organizationId);
  const [tab, setTab] = useState<PickerTab>('dashboards');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { charts, isLoading: chartsLoading } = useCharts(expandedId);
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [catalogCharts, setCatalogCharts] = useState<CatalogChart[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [publishedItems, setPublishedItems] = useState<FeedItem[]>([]);
  const [publishedLoading, setPublishedLoading] = useState(false);

  const dashboards = useMemo(() => {
    const byId = new Map<string, Dashboard>();
    for (const d of [...projectDashboards, ...ownedDashboards]) {
      if (d?.id) byId.set(String(d.id), d);
    }
    return Array.from(byId.values());
  }, [ownedDashboards, projectDashboards]);
  const dashboardsLoading = ownedLoading || (Boolean(projectId) && projectLoading);

  const projectById = useMemo(() => new Map(projects.map((p) => [String(p.id), p])), [projects]);
  const excludedSet = useMemo(() => new Set(excludeIds.map(String)), [excludeIds]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setExpandedId(null);
      setTab('dashboards');
    }
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'charts' || dashboards.length === 0) {
      if (tab !== 'charts') setCatalogCharts([]);
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    void Promise.all(
      dashboards.slice(0, 40).map(async (dashboard) => {
        const list = await listCharts(dashboard.id).catch(() => [] as Chart[]);
        const rows = Array.isArray(list) ? list : [];
        return rows.map((chart) => ({
          ...chart,
          dashboardTitle: dashboard.title,
          dashboard_id: chart.dashboard_id || dashboard.id,
        }));
      }),
    )
      .then((groups) => {
        if (!cancelled) setCatalogCharts(groups.flat());
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, dashboards]);

  useEffect(() => {
    if (!open || tab !== 'published' || !user?.id) {
      return;
    }
    let cancelled = false;
    setPublishedLoading(true);
    const scopes: FeedScope[] = ['private'];
    if (organizationId) scopes.push('organization');
    if (projectId) scopes.push('project');
    void Promise.all(
      scopes.map((scope) =>
        socialFeedService
          .getFeed({
            scope,
            authorId: user.id,
            sort: 'recent',
            limit: 40,
            organizationId,
            projectId,
          })
          .catch(() => ({ items: [] as FeedItem[] })),
      ),
    )
      .then((pages) => {
        if (cancelled) return;
        const byId = new Map<string, FeedItem>();
        for (const page of pages) {
          for (const item of page.items || []) {
            if (!['dashboard', 'chart', 'insight'].includes(item.assetType)) continue;
            byId.set(item.id, item);
          }
        }
        setPublishedItems(
          Array.from(byId.values()).sort(
            (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
          ),
        );
      })
      .finally(() => {
        if (!cancelled) setPublishedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, user?.id, organizationId, projectId]);

  const query = search.trim().toLowerCase();

  const filteredDashboards = useMemo(
    () =>
      dashboards
        .filter((d) => !excludedSet.has(d.id))
        .filter((d) => !query || d.title.toLowerCase().includes(query)),
    [dashboards, excludedSet, query],
  );

  const filteredCharts = useMemo(
    () =>
      catalogCharts
        .filter((c) => !excludedSet.has(c.id))
        .filter((c) => {
          if (!query) return true;
          const title = (c.title || '').toLowerCase();
          return title.includes(query) || c.dashboardTitle.toLowerCase().includes(query);
        }),
    [catalogCharts, excludedSet, query],
  );

  const filteredPublished = useMemo(
    () =>
      publishedItems
        .filter((item) => !excludedSet.has(item.id) && !excludedSet.has(item.assetId))
        .filter((item) => {
          if (!query) return true;
          return (
            item.title.toLowerCase().includes(query) ||
            (item.description || '').toLowerCase().includes(query)
          );
        }),
    [publishedItems, excludedSet, query],
  );

  const finishPick = (attachment: PickedAttachment, captured: boolean) => {
    onPick(attachment);
    if (captured) {
      message.success(t('attach_success', { title: attachment.title }));
    } else {
      message.success(t('attach_success_live', { title: attachment.title }));
    }
    onClose();
  };

  const pickDashboard = async (dashboard: Dashboard) => {
    setCapturingId(dashboard.id);
    try {
      const snapshot_payload = await buildDashboardAttachmentSnapshot(dashboard.id, dashboard.title);
      finishPick(
        { asset_type: 'dashboard', asset_id: dashboard.id, title: dashboard.title, snapshot_payload },
        Boolean(snapshot_payload),
      );
    } catch {
      message.error(t('attach_failed'));
    } finally {
      setCapturingId(null);
    }
  };

  const pickChart = async (chart: { id: string; title?: string }, dashboard: { id: string; title: string }) => {
    setCapturingId(chart.id);
    try {
      const snapshot_payload = await buildChartAttachmentSnapshot(
        dashboard.id,
        chart.id,
        chart.title || dashboard.title,
      );
      finishPick(
        {
          asset_type: 'chart',
          asset_id: chart.id,
          title: chart.title || dashboard.title,
          snapshot_payload,
        },
        Boolean(snapshot_payload),
      );
    } catch {
      message.error(t('attach_failed'));
    } finally {
      setCapturingId(null);
    }
  };

  const pickPublished = async (item: FeedItem) => {
    if (item.assetType !== 'dashboard' && item.assetType !== 'chart' && item.assetType !== 'insight') {
      return;
    }
    setCapturingId(item.id);
    try {
      let snapshot_payload: Record<string, unknown> | null = item.asset.snapshotPayload ?? null;
      if (!snapshot_payload && item.assetType === 'dashboard') {
        snapshot_payload = await buildDashboardAttachmentSnapshot(item.assetId, item.title);
      }
      if (!snapshot_payload && item.assetType === 'chart' && item.asset.dashboardId) {
        snapshot_payload = await buildChartAttachmentSnapshot(item.asset.dashboardId, item.assetId, item.title);
      }
      finishPick(
        {
          asset_type: item.assetType,
          asset_id: item.assetId,
          title: item.title,
          snapshot_payload,
          publication_id: item.id,
        },
        Boolean(snapshot_payload),
      );
    } catch {
      message.error(t('attach_failed'));
    } finally {
      setCapturingId(null);
    }
  };

  const searchPlaceholder =
    tab === 'charts'
      ? t('attach_insight_search_charts')
      : tab === 'published'
        ? t('attach_insight_search_published')
        : t('attach_insight_search_dashboards');

  const dashboardList = dashboardsLoading ? (
    <div style={{ textAlign: 'center', padding: 24 }}>
      <Spin />
    </div>
  ) : filteredDashboards.length === 0 ? (
    <Empty description={t('attach_empty_dashboards')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
  ) : (
    <List
      dataSource={filteredDashboards}
      renderItem={(dashboard) => {
        const project = dashboard.project_id ? projectById.get(String(dashboard.project_id)) : undefined;
        const isPrivate = Boolean(project?.is_private);
        const isExpanded = expandedId === dashboard.id;
        return (
          <div key={dashboard.id} className="border-b border-[var(--ant-color-border-secondary)] last:border-b-0">
            <List.Item
              actions={[
                <Button
                  key="expand"
                  type="text"
                  size="small"
                  icon={isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
                  onClick={() => setExpandedId(isExpanded ? null : dashboard.id)}
                >
                  {t('attach_insight_show_charts')}
                </Button>,
                <Button
                  key="add"
                  type="link"
                  size="small"
                  loading={capturingId === dashboard.id}
                  disabled={capturingId !== null && capturingId !== dashboard.id}
                  onClick={() => void pickDashboard(dashboard)}
                >
                  {t('attach_insight_add')}
                </Button>,
              ]}
            >
              <List.Item.Meta
                avatar={<DashboardOutlined style={{ fontSize: 18, color: 'var(--ant-color-primary)' }} />}
                title={dashboard.title}
                description={
                  isPrivate ? (
                    <Tag icon={<LockOutlined />} className="m-0 text-xs">
                      {t('attach_insight_private_hint', { owner: project?.owner_name || t('attach_insight_you') })}
                    </Tag>
                  ) : null
                }
              />
            </List.Item>
            {isExpanded && (
              <div className="flex flex-col gap-1 pb-2 pl-9 pr-3">
                {chartsLoading ? (
                  <Spin size="small" />
                ) : charts.filter((c) => !excludedSet.has(c.id)).length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('attach_insight_no_charts')}
                  </Text>
                ) : (
                  charts
                    .filter((c) => !excludedSet.has(c.id))
                    .map((chart) => (
                      <div key={chart.id} className="flex items-center justify-between gap-2 py-0.5">
                        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm">
                          <LineChartOutlined style={{ color: 'var(--ant-color-primary)' }} />
                          <span className="truncate">{chart.title || t('attachment_untitled_chart')}</span>
                        </span>
                        <Button
                          type="link"
                          size="small"
                          loading={capturingId === chart.id}
                          disabled={capturingId !== null && capturingId !== chart.id}
                          onClick={() => void pickChart(chart, dashboard)}
                        >
                          {t('attach_insight_add')}
                        </Button>
                      </div>
                    ))
                )}
              </div>
            )}
          </div>
        );
      }}
    />
  );

  const chartsList = catalogLoading ? (
    <div style={{ textAlign: 'center', padding: 24 }}>
      <Spin />
    </div>
  ) : filteredCharts.length === 0 ? (
    <Empty description={t('attach_empty_charts')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
  ) : (
    <List
      dataSource={filteredCharts}
      renderItem={(chart) => (
        <List.Item
          actions={[
            <Button
              key="add"
              type="link"
              size="small"
              loading={capturingId === chart.id}
              disabled={capturingId !== null && capturingId !== chart.id}
              onClick={() =>
                void pickChart(chart, { id: chart.dashboard_id, title: chart.dashboardTitle })
              }
            >
              {t('attach_insight_add')}
            </Button>,
          ]}
        >
          <List.Item.Meta
            avatar={<LineChartOutlined style={{ fontSize: 18, color: 'var(--ant-color-primary)' }} />}
            title={chart.title || t('attachment_untitled_chart')}
            description={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {chart.dashboardTitle}
              </Text>
            }
          />
        </List.Item>
      )}
    />
  );

  const publishedList = publishedLoading ? (
    <div style={{ textAlign: 'center', padding: 24 }}>
      <Spin />
    </div>
  ) : filteredPublished.length === 0 ? (
    <Empty description={t('attach_empty_published')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
  ) : (
    <List
      dataSource={filteredPublished}
      renderItem={(item) => {
        const Icon =
          item.assetType === 'dashboard'
            ? DashboardOutlined
            : item.assetType === 'insight'
              ? BulbOutlined
              : LineChartOutlined;
        const typeLabel =
          item.assetType === 'dashboard'
            ? t('attach_published_dashboard')
            : item.assetType === 'insight'
              ? t('attach_published_insight')
              : t('attach_published_chart');
        return (
          <List.Item
            actions={[
              <Button
                key="add"
                type="link"
                size="small"
                loading={capturingId === item.id}
                disabled={capturingId !== null && capturingId !== item.id}
                onClick={() => void pickPublished(item)}
              >
                {t('attach_insight_add')}
              </Button>,
            ]}
          >
            <List.Item.Meta
              avatar={<Icon style={{ fontSize: 18, color: 'var(--ant-color-primary)' }} />}
              title={item.title}
              description={
                <span className="flex items-center gap-1.5">
                  <Tag className="m-0 text-xs">{typeLabel}</Tag>
                  {item.description ? (
                    <Text type="secondary" ellipsis style={{ fontSize: 12, maxWidth: 240 }}>
                      {item.description}
                    </Text>
                  ) : null}
                </span>
              }
            />
          </List.Item>
        );
      }}
    />
  );

  return (
    <Modal
      title={t('attach_insight_title')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={520}
      styles={{ body: { maxHeight: '64vh', overflowY: 'auto' } }}
    >
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder={searchPlaceholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as PickerTab)}
        size="small"
        items={[
          {
            key: 'dashboards',
            label: t('attach_tab_dashboards'),
            children: dashboardList,
          },
          {
            key: 'charts',
            label: t('attach_tab_charts'),
            children: chartsList,
          },
          {
            key: 'published',
            label: t('attach_tab_published'),
            children: publishedList,
          },
        ]}
      />
    </Modal>
  );
}

export default AttachmentPicker;
