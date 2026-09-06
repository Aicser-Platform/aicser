'use client';

import React, { useMemo, useState } from 'react';
import { Modal, Input, List, Button, Empty, Spin, Tag, Typography } from 'antd';
import { CaretDownOutlined, CaretRightOutlined, DashboardOutlined, LineChartOutlined, LockOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useDashboards, useCharts } from '@/hooks/useDashboards';
import { useProjects } from '@/hooks/useProjects';
import type { AttachmentRef } from '@/services/socialFeedService';
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

/**
 * Pick an existing dashboard - or a specific chart within one - to attach to
 * a new post. Lists every dashboard the AUTHOR themselves has access to,
 * across all their projects, not just whichever project happens to be active
 * in the header (a post's own visibility - e.g. "Only me" - often has no
 * project association at all, so scoping this list to the active project hid
 * dashboards from OTHER projects the user plainly owns). The publish-time
 * access check (_can_view_dashboard_or_chart) re-validates whichever one is
 * actually picked regardless of this list's scope, so widening it here is
 * safe.
 *
 * Chart listing uses `useCharts` -> `GET dashboards/{id}/charts`, the same
 * endpoint the real dashboards app uses to render a dashboard's widgets
 * (backed by the `dashboard_charts` placement table) - NOT the standalone
 * `charts` table's own `dashboard_id` column, which is a legacy field left
 * unpopulated in practice, and not `hooks/useDashboards.ts`'s singular
 * `useDashboard(id)` either, which (separately, still unfixed - it's unused
 * elsewhere so nothing else depends on the current behavior) reads a
 * `charts` field the dashboard-detail response doesn't actually return.
 *
 * A dashboard living in a private project is flagged before attaching, so
 * the author can see up front that most teammates won't be able to open it
 * (the recipient still just sees a "Restricted" placeholder, per the
 * per-viewer check in service_serialization.py - this is a heads-up, not a
 * hard block, since the author may legitimately be posting to that same
 * private audience).
 */
export function AttachmentPicker({ open, excludeIds, organizationId, onPick, onClose }: AttachmentPickerProps) {
  const t = useTranslations('feed_page');
  const { dashboards, isLoading } = useDashboards();
  const { projects } = useProjects(organizationId);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { charts, isLoading: chartsLoading } = useCharts(expandedId);
  const [capturingId, setCapturingId] = useState<string | null>(null);

  const projectById = useMemo(() => new Map(projects.map((p) => [String(p.id), p])), [projects]);
  const excludedSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return dashboards
      .filter((d) => !excludedSet.has(d.id))
      .filter((d) => !query || d.title.toLowerCase().includes(query));
  }, [dashboards, excludedSet, search]);

  const pickDashboard = async (dashboard: (typeof dashboards)[number]) => {
    setCapturingId(dashboard.id);
    try {
      const snapshot_payload = await buildDashboardAttachmentSnapshot(dashboard.id, dashboard.title);
      onPick({ asset_type: 'dashboard', asset_id: dashboard.id, title: dashboard.title, snapshot_payload });
      onClose();
    } finally {
      setCapturingId(null);
    }
  };

  const pickChart = async (chart: { id: string; title?: string }, dashboard: { id: string; title: string }) => {
    setCapturingId(chart.id);
    try {
      const snapshot_payload = await buildChartAttachmentSnapshot(dashboard.id, chart.id, chart.title || dashboard.title);
      onPick({ asset_type: 'chart', asset_id: chart.id, title: chart.title || dashboard.title, snapshot_payload });
      onClose();
    } finally {
      setCapturingId(null);
    }
  };

  return (
    <Modal
      title={t('attach_insight_title')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
      styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
    >
      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder={t('attach_insight_search_placeholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : filtered.length === 0 ? (
        <Empty description={t('attach_insight_empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          dataSource={filtered}
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
      )}
    </Modal>
  );
}

export default AttachmentPicker;
