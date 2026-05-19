'use client';
export const dynamic = 'force-dynamic';

import React, { useEffect, useMemo, useState } from 'react';
import { Avatar, Button, Card, Empty, Tag, Typography, Spin } from 'antd';
import {
  ArrowLeftOutlined,
  CommentOutlined,
  DashboardOutlined,
  EditOutlined,
  EyeOutlined,
  LikeOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useParams, useRouter } from 'next/navigation';
import type { FeedItem } from '@/services/socialFeedService';
import { formatTimeAgo, socialFeedService } from '@/services/socialFeedService';
import FeedDetailSkeleton from '../components/FeedDetailSkeleton';
import FeedPreviewVisual from '../components/FeedPreviewVisual';
import { chartService } from '../../dashboards/services/chartService';
import { WidgetPreview } from '../../dashboards/widgets/WidgetPreview';
import type { WidgetInstance } from '../../dashboards/stores/useDashboardStore'
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useTranslations } from 'next-intl';
import '../styles.css';

const { Text, Paragraph } = Typography;

const FeedDetailPage: React.FC = () => {
  const t = useTranslations('feed');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const itemId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  const { user } = useAuth();

  const [item, setItem] = useState<FeedItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardWidgets, setDashboardWidgets] = useState<WidgetInstance[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    socialFeedService
      .getItemById(itemId)
      .then((result) => {
        if (!active) return;
        setItem(result);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [itemId]);

  useEffect(() => {
    if (!item || item.assetType !== 'dashboard') {
      setDashboardWidgets([]);
      setDashboardError(null);
      return;
    }

    let active = true;
    setDashboardLoading(true);
    setDashboardError(null);

    chartService
      .listCharts(item.assetId)
      .then(async (charts: any[]) => {
        const widgets = await Promise.all(
          charts.map(async (chart: any) => {
            const widgetId = `feed-${chart.id}`;
            let chartData = undefined;
            let error: string | null = null;

            if (chart.chartType !== 'text') {
              try {
                const response = await chartService.executeChart(item.assetId, chart.id);
                chartData = response.data;
              } catch (err) {
                error = err instanceof Error ? err.message : t('detail_err_chart_data');
              }
            }

            return {
              id: widgetId,
              chartId: chart.id,
              title: chart.title || t('untitled_chart'),
              chartType: chart.chartType,
              chartQuery: chart.chartQuery,
              chartOptions: chart.chartOptions,
              chartData,
              isLoading: false,
              error,
            } as WidgetInstance;
          })
        );

        if (!active) return;
        const sorted = widgets.sort((a: any, b: any) => {
          const layoutA = (charts.find((c: any) => c.id === a.chartId)?.layout || {}) as any;
          const layoutB = (charts.find((c: any) => c.id === b.chartId)?.layout || {}) as any;
          if (layoutA.y === layoutB.y) return (layoutA.x || 0) - (layoutB.x || 0);
          return (layoutA.y || 0) - (layoutB.y || 0);
        });
        setDashboardWidgets(sorted);
      })
      .catch((err) => {
        if (!active) return;
        setDashboardError(err instanceof Error ? err.message : t('detail_err_dashboard'));
      })
      .finally(() => {
        if (!active) return;
        setDashboardLoading(false);
      });

    return () => {
      active = false;
    };
  }, [item, t]);

  useEffect(() => {
    if (!itemId) return;
    let active = true;

    socialFeedService
      .trackView(itemId)
      .then((response) => {
        if (!active) return;
        setItem((prev) =>
          prev
            ? {
                ...prev,
                metrics: { ...prev.metrics, views: response.view_count },
              }
            : prev
        );
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [itemId]);

  const mockDataset = useMemo(() => {
    if (!item) return [];
    const previewFromDashboard = item.asset.previews?.find((preview) => preview.data && preview.data.length > 0);
    const base = item.asset.previewData?.length
      ? item.asset.previewData
      : previewFromDashboard?.data
        ? previewFromDashboard.data
        : [34, 52, 41, 63, 49, 72];
    return base.map((value, index) => {
      const prev = index === 0 ? value : base[index - 1];
      const delta = value - prev;
      return {
        label: t('preview_week_label', { week: index + 1 }),
        value,
        delta,
      };
    });
  }, [item, t]);

  if (loading) {
    return <FeedDetailSkeleton />;
  }

  if (!item) {
    return (
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => router.push('/feed')}
            className="flex items-center rounded-md text-sm font-medium border-[var(--ant-color-border)] text-[var(--ant-color-text)] hover:text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)] h-9 px-4 transition-colors"
          >
            {t('back_to_feed')}
          </Button>
        </div>
        <Empty
          description={t('detail_not_found')}
          className="my-12 py-12 bg-[var(--ant-color-bg-container)] rounded-xl border border-[var(--ant-color-border-secondary)] shadow-sm"
        />
      </div>
    );
  }

  const visibilityLabel =
    item.visibility === 'organization'
      ? t('scope_organization')
      : item.visibility === 'project'
        ? t('scope_project')
        : t('scope_public');
  const isDashboard = item.assetType === 'dashboard';
  const isPostOwner = !!user && item.author?.id === user.id;
  const canEditDashboard = isDashboard && isPostOwner;

  return (
    <div
      className={`max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 ${isDashboard ? 'max-w-full px-4 sm:px-6 lg:px-8' : ''}`}
    >
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => router.push('/feed')}
              className="flex items-center rounded-md text-sm font-medium border-[var(--ant-color-border)] text-[var(--ant-color-text)] hover:text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)] h-9 px-4 transition-colors"
            >
              {t('back_to_feed')}
            </Button>
            <div className="flex items-center text-sm text-[var(--ant-color-text-secondary)] font-medium">
              <span
                className="hover:text-[var(--ant-color-text)] cursor-pointer transition-colors"
                onClick={() => router.push('/feed')}
              >
                {t('breadcrumb_feed')}
              </span>
              <span className="mx-2 text-gray-300">/</span>
              <span className="text-[var(--ant-color-text)]">
                {isDashboard
                  ? t('breadcrumb_dashboard')
                  : item.assetType === 'chart'
                    ? t('charts_type')
                    : item.assetType === 'insight'
                      ? t('insights_type')
                      : item.assetType.toUpperCase()}
              </span>
            </div>
          </div>
          <div className="flex items-center">
            {isDashboard ? (
              canEditDashboard ? (
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => router.push(`/dash-studio?tab=dashboard&id=${item.assetId}`)}
                  className="bg-[var(--ant-color-primary)] hover:bg-blue-700 h-9 rounded-md font-medium"
                >
                  Edit dashboard
                </Button>
              ) : user ? (
                <Button
                  icon={<DashboardOutlined />}
                  onClick={() => router.push('/dash-studio')}
                  className="h-9 rounded-md font-medium"
                >
                  Go to my dashboards
                </Button>
              ) : null
            ) : (
              <Button
                type="primary"
                onClick={() => router.push('/dashboards')}
                className="bg-[var(--ant-color-primary)] hover:bg-[var(--ant-color-primary-hover)] h-9 rounded-md font-medium"
              >
                Open in dashboard
              </Button>
            )}
          </div>
        </div>

        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold text-[var(--ant-color-text)] tracking-tight mb-3">{item.title}</h1>
          <p className="text-lg text-[var(--ant-color-text-secondary)] leading-relaxed mb-4">{item.description}</p>
          <div className="flex flex-wrap gap-2">
            <span className="px-2.5 py-1 bg-[var(--ant-color-border-secondary)] text-[var(--ant-color-text)] rounded-md text-xs font-semibold">
              {item.assetType.toUpperCase()}
            </span>
            <span className="px-2.5 py-1 bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)] border border-[var(--ant-color-primary-border)] rounded-md text-xs font-semibold">
              {visibilityLabel}
            </span>
            {item.approvalStatus !== 'approved' && (
              <span className="px-2.5 py-1 bg-[var(--ant-color-warning-bg)] text-[var(--ant-color-warning)] border border-[var(--ant-color-warning-border)] rounded-md text-xs font-semibold">
                {item.approvalStatus}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className={`flex flex-col lg:flex-row gap-8 items-start ${isDashboard ? 'flex-col' : ''}`}>
        <div className={`flex-1 w-full flex flex-col gap-6 ${isDashboard ? 'lg:flex-1' : 'min-w-0'}`}>
          <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden">
            <div className={`flex flex-col ${isDashboard ? '' : 'sm:flex-row'}`}>
              <div
                className={`w-full bg-[var(--ant-color-bg-layout)] p-6 ${isDashboard ? '' : 'sm:w-2/3 border-b sm:border-b-0 sm:border-r border-[var(--ant-color-border-secondary)]'}`}
              >
                {isDashboard ? (
                  <div className="bg-[var(--ant-color-bg-container)] rounded-xl shadow-sm border border-[var(--ant-color-border)] overflow-hidden flex flex-col h-[800px]">
                    <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-layout)]">
                      <div className="flex items-center gap-3">
                        <span className="px-2 py-1 bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] text-[var(--ant-color-text)] text-xs font-semibold rounded-md shadow-sm">
                          Report
                        </span>
                        <span className="text-sm text-[var(--ant-color-text-secondary)] font-medium">
                          Updated {formatTimeAgo(item.lastActivityAt)}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <span className="text-sm text-[var(--ant-color-text-secondary)] font-medium flex items-center gap-1.5">
                          <EyeOutlined className="text-[var(--ant-color-text-description)]" /> {visibilityLabel}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto p-6 bg-[var(--ant-color-bg-layout)]/30">
                      {dashboardLoading ? (
                        <div className="flex items-center justify-center h-64">
                          <Spin tip="Loading dashboard..." size="large" />
                        </div>
                      ) : dashboardError ? (
                        <Empty
                          description="Unable to load dashboard."
                          className="my-12 py-12 bg-[var(--ant-color-bg-container)] rounded-xl border border-[var(--ant-color-border-secondary)] shadow-sm"
                        />
                      ) : dashboardWidgets.length === 0 ? (
                        <Empty
                          description="No charts available for this dashboard."
                          className="my-12 py-12 bg-[var(--ant-color-bg-container)] rounded-xl border border-[var(--ant-color-border-secondary)] shadow-sm"
                        />
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {dashboardWidgets.map((widget) => (
                            <div
                              key={widget.id}
                              className="bg-[var(--ant-color-bg-container)] rounded-xl shadow-sm border border-[var(--ant-color-border)] overflow-hidden flex flex-col h-96 transition-shadow hover:shadow-md"
                            >
                              <div className="px-5 py-4 border-b border-[var(--ant-color-border-secondary)] flex items-center justify-between bg-[var(--ant-color-bg-container)]">
                                <span className="font-semibold text-[var(--ant-color-text)] truncate">
                                  {widget.title}
                                </span>
                              </div>
                              <div className="flex-1 p-5 overflow-hidden">
                                <WidgetPreview widget={widget} readOnly />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="px-6 py-3 border-t border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] flex gap-4">
                      <span className="text-sm font-medium text-[var(--ant-color-primary)] border-b-2 border-[var(--ant-color-primary)] pb-1 -mb-3 pt-1">
                        {item.asset.previewLabel || 'Dashboard'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col justify-center items-center">
                    <div className="w-full aspect-[4/3] bg-[var(--ant-color-bg-container)] rounded-xl shadow-sm border border-[var(--ant-color-border)] overflow-hidden flex flex-col relative group">
                      <div className="absolute top-4 left-4 z-10">
                        <span className="px-2.5 py-1 bg-[var(--ant-color-bg-container)]/90 backdrop-blur border border-[var(--ant-color-border)] shadow-sm rounded-md text-xs font-semibold text-[var(--ant-color-text)]">
                          {item.asset.previewLabel}
                        </span>
                      </div>
                      <div className="flex-1 p-1">
                        <FeedPreviewVisual item={item} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {!isDashboard && (
                <div className="w-full sm:w-1/3 p-6 flex flex-col">
                  <h3 className="text-sm font-semibold text-[var(--ant-color-text)] uppercase tracking-wider mb-3">
                    Summary
                  </h3>
                  <p className="text-[var(--ant-color-text-secondary)] text-sm leading-relaxed mb-6">
                    {item.asset.summary}
                  </p>

                  {item.tags && item.tags.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-sm font-semibold text-[var(--ant-color-text)] uppercase tracking-wider mb-3">
                        Tags
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {item.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2.5 py-1 bg-[var(--ant-color-border-secondary)] text-[var(--ant-color-text-secondary)] rounded-md text-xs font-medium"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto pt-6 border-t border-[var(--ant-color-border-secondary)]">
                    <div>
                      <h3 className="text-xs font-semibold text-[var(--ant-color-text-secondary)] uppercase tracking-wider mb-1">
                        Asset ID
                      </h3>
                      <span className="font-mono text-xs text-[var(--ant-color-text-secondary)] bg-[var(--ant-color-border-secondary)] px-2 py-1 rounded">
                        {item.assetId}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {!isDashboard && (
            <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden mt-6">
              <div className="px-6 py-4 border-b border-[var(--ant-color-border-secondary)]">
                <h2 className="text-base font-semibold text-[var(--ant-color-text)]">{t('data_snapshot')}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-[var(--ant-color-text-secondary)] uppercase bg-[var(--ant-color-bg-layout)] border-b border-[var(--ant-color-border-secondary)]">
                    <tr>
                      <th scope="col" className="px-6 py-3 font-medium">
                        Period
                      </th>
                      <th scope="col" className="px-6 py-3 font-medium">
                        Value
                      </th>
                      <th scope="col" className="px-6 py-3 font-medium">
                        Change
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockDataset.map((row, index) => (
                      <tr
                        key={row.label}
                        className={`border-b border-[var(--ant-color-border-secondary)] last:border-0 hover:bg-[var(--ant-color-bg-layout)] transition-colors ${index % 2 === 0 ? 'bg-[var(--ant-color-bg-container)]' : 'bg-[var(--ant-color-bg-layout)]/30'}`}
                      >
                        <td className="px-6 py-4 font-medium text-[var(--ant-color-text)] whitespace-nowrap">
                          {row.label}
                        </td>
                        <td className="px-6 py-4 text-[var(--ant-color-text-secondary)]">{row.value}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              row.delta > 0
                                ? 'bg-[var(--ant-color-success-bg)] text-[var(--ant-color-success)] border border-[var(--ant-color-success-border)]'
                                : row.delta < 0
                                  ? 'bg-[var(--ant-color-error-bg)] text-[var(--ant-color-error)] border border-[var(--ant-color-error-border)]'
                                  : 'bg-[var(--ant-color-border-secondary)] text-[var(--ant-color-text-secondary)] border border-[var(--ant-color-border)]'
                            }`}
                          >
                            {row.delta > 0 ? `+${row.delta}` : row.delta}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div
            id="comments"
            className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden mt-6"
          >
            <div className="px-6 py-4 border-b border-[var(--ant-color-border-secondary)] flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--ant-color-text)]">{t('recent_comments')}</h2>
              <span className="bg-[var(--ant-color-border-secondary)] text-[var(--ant-color-text-secondary)] text-xs font-semibold px-2 py-0.5 rounded-full">
                {(item.recentComments ?? []).length}
              </span>
            </div>

            {(item.recentComments ?? []).length === 0 ? (
              <div className="p-8">
                <Empty description="No comments yet" className="opacity-60" />
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {(item.recentComments ?? []).map((comment) => (
                  <div
                    key={comment.id}
                    className="p-6 flex gap-4 hover:bg-[var(--ant-color-bg-layout)] transition-colors"
                  >
                    <Avatar
                      size={40}
                      src={comment.author.avatarUrl}
                      className="shrink-0 border border-[var(--ant-color-border)] shadow-sm"
                    >
                      {comment.author.name.charAt(0)}
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-sm font-semibold text-[var(--ant-color-text)] truncate">
                          {comment.author.name}
                        </h4>
                        <span className="text-xs text-[var(--ant-color-text-secondary)] whitespace-nowrap ml-4">
                          {formatTimeAgo(comment.createdAt)}
                        </span>
                      </div>
                      <div className="text-sm text-[var(--ant-color-text)] leading-relaxed bg-[var(--ant-color-bg-layout)] rounded-lg p-3 border border-[var(--ant-color-border-secondary)] mt-2">
                        {comment.content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {!isDashboard && (
          <aside className="w-full lg:w-80 flex flex-col gap-6 shrink-0">
            <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-layout)]">
                <h3 className="text-sm font-semibold text-[var(--ant-color-text)]">{t('author')}</h3>
              </div>
              <div className="p-5 flex items-center gap-4 hover:bg-[var(--ant-color-bg-layout)] transition-colors cursor-pointer group">
                <Avatar
                  size={48}
                  src={item.author.avatarUrl}
                  className="border border-[var(--ant-color-border)] shadow-sm group-hover:scale-105 transition-transform"
                >
                  {item.author.name.charAt(0)}
                </Avatar>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-[var(--ant-color-text)] group-hover:text-[var(--ant-color-primary)] transition-colors">
                    {item.author.name}
                  </span>
                  <span className="text-xs text-[var(--ant-color-text-secondary)] mt-0.5">@{item.author.username}</span>
                  {item.author.title && (
                    <span className="text-xs text-[var(--ant-color-text-secondary)] mt-1 line-clamp-1">
                      {item.author.title}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-layout)]">
                <h3 className="text-sm font-semibold text-[var(--ant-color-text)]">{t('engagement')}</h3>
              </div>
              <div className="p-2 grid grid-cols-2 gap-2">
                <div className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-[var(--ant-color-bg-layout)] transition-colors">
                  <div className="flex items-center gap-1.5 text-[var(--ant-color-text)] font-semibold mb-1">
                    <EyeOutlined className="text-[var(--ant-color-text-description)]" />{' '}
                    <span>{item.metrics.views}</span>
                  </div>
                  <span className="text-xs text-[var(--ant-color-text-secondary)] font-medium uppercase tracking-wider">
                    Views
                  </span>
                </div>
                <div className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-[var(--ant-color-bg-layout)] transition-colors">
                  <div className="flex items-center gap-1.5 text-[var(--ant-color-text)] font-semibold mb-1">
                    <CommentOutlined className="text-[var(--ant-color-text-description)]" />{' '}
                    <span>{item.metrics.comments}</span>
                  </div>
                  <span className="text-xs text-[var(--ant-color-text-secondary)] font-medium uppercase tracking-wider">
                    Comments
                  </span>
                </div>
                <div className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-[var(--ant-color-bg-layout)] transition-colors">
                  <div className="flex items-center gap-1.5 text-[var(--ant-color-text)] font-semibold mb-1">
                    <LikeOutlined className="text-[var(--ant-color-text-description)]" />{' '}
                    <span>{item.metrics.reactions}</span>
                  </div>
                  <span className="text-xs text-[var(--ant-color-text-secondary)] font-medium uppercase tracking-wider">
                    Reactions
                  </span>
                </div>
                <div className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-[var(--ant-color-bg-layout)] transition-colors">
                  <div className="flex items-center gap-1.5 text-[var(--ant-color-text)] font-semibold mb-1">
                    <StarOutlined className="text-[var(--ant-color-text-description)]" />{' '}
                    <span>{item.metrics.bookmarks}</span>
                  </div>
                  <span className="text-xs text-[var(--ant-color-text-secondary)] font-medium uppercase tracking-wider">
                    Bookmarks
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-layout)]">
                <h3 className="text-sm font-semibold text-[var(--ant-color-text)]">{t('publishing')}</h3>
              </div>
              <div className="p-5 flex flex-col gap-4">
                <div className="flex justify-between items-center pb-3 border-b border-[var(--ant-color-border-secondary)]">
                  <span className="text-sm text-[var(--ant-color-text-secondary)]">{t('visibility')}</span>
                  <span className="text-sm font-semibold text-[var(--ant-color-text)]">{visibilityLabel}</span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-[var(--ant-color-border-secondary)]">
                  <span className="text-sm text-[var(--ant-color-text-secondary)]">{t('status')}</span>
                  <span
                    className={`text-sm font-semibold px-2 py-0.5 rounded-md ${
                      item.approvalStatus === 'approved' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {item.approvalStatus.charAt(0).toUpperCase() + item.approvalStatus.slice(1)}
                  </span>
                </div>
                <div className="flex justify-between items-center pb-3 border-b border-[var(--ant-color-border-secondary)]">
                  <span className="text-sm text-[var(--ant-color-text-secondary)]">{t('published')}</span>
                  <span className="text-sm font-medium text-[var(--ant-color-text)]">
                    {formatTimeAgo(item.publishedAt)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[var(--ant-color-text-secondary)]">{t('last_activity')}</span>
                  <span className="text-sm font-medium text-[var(--ant-color-text)]">
                    {formatTimeAgo(item.lastActivityAt)}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

export default FeedDetailPage;
