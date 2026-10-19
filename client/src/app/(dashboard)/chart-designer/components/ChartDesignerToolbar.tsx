'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Dropdown, Input, Segmented, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  ShareAltOutlined,
  FullscreenOutlined,
  MoreOutlined,
  BlockOutlined,
  DeleteOutlined,
  GlobalOutlined,
  LinkOutlined,
  DashboardOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileTextOutlined,
  BarChartOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { ADD_TO_DASHBOARD_EVENT, TRASH_CHART_EVENT } from './chartDesignerEvents';
import { useTranslations } from 'next-intl';
import PublishToFeedModal from '@/components/Feed/PublishToFeedModal';
import { buildChartSnapshotPayload } from '@/app/(dashboard)/feed/utils/buildFeedSnapshotPayload';
import { formatFeedPublishError } from '@/components/Feed/feedPublishUtils';
import { menuItemWithDescription } from '@/components/Feed/MenuItemWithDescription';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { EmbedDialog } from '@/components/embed/EmbedDialog';
import type { ChartDesignerWidget } from '../stores/useChartDesignerStore';
import { useChartDesignerStore } from '../stores/useChartDesignerStore';
import { chartDescription, chartSource } from '../../dashboards/utils/chartAnnotations';
import { InlineText } from '../../dashboards/components/InlineText';
import { emitWidgetOptionsPatch } from '../../dashboards/widgets/inlineEditEvents';
import { copyChartData, exportCSV, exportExcel } from '../../dashboards/services/exportChartDataService';
import { exportChartByWidget } from '../../dashboards/services/exportChartImageService';

interface ChartDesignerToolbarProps {
  selectedWidget: ChartDesignerWidget | null;
  /** The canvas shows the chart or the data behind it. */
  view?: 'chart' | 'data';
  onViewChange?: (view: 'chart' | 'data') => void;
  /** Show the chart as viewers see it, without the editor. */
  onPreview?: () => void;
}

export function ChartDesignerToolbar({ selectedWidget, view = 'chart', onViewChange, onPreview }: ChartDesignerToolbarProps) {
  const t = useTranslations('chart_designer');
  const tDash = useTranslations('dashboards');
  const tf = useTranslations('feed_publish');

  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id != null ? String(currentProject.id) : undefined;
  const organizationId =
    currentProject?.organization_id ||
    (currentProject as { organizationId?: string } | null)?.organizationId ||
    undefined;

  const saveChart = useChartDesignerStore((s) => s.saveChart);
  const updateChartAndFetchData = useChartDesignerStore((s) => s.updateChartAndFetchData);
  const isSaving = useChartDesignerStore((s) => s.isSaving);
  const duplicateWidget = useChartDesignerStore((s) => s.duplicateWidget);

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishChartId, setPublishChartId] = useState<string | undefined>();
  const [publishTitle, setPublishTitle] = useState('');
  const [publishPreviewMetadata, setPublishPreviewMetadata] = useState<Record<string, unknown> | undefined>();
  const [publishSnapshotPayload, setPublishSnapshotPayload] = useState<Record<string, unknown> | undefined>();
  const [publishCaptureSelector, setPublishCaptureSelector] = useState<string | undefined>();
  const [preparing, setPreparing] = useState(false);
  const [embedChartId, setEmbedChartId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');

  useEffect(() => {
    setTitleDraft(selectedWidget?.title?.trim() || '');
  }, [selectedWidget?.id, selectedWidget?.title]);

  const commitTitle = useCallback(() => {
    if (!selectedWidget) return;
    const next = titleDraft.trim() || t('untitled_chart');
    if (next !== (selectedWidget.title || '')) {
      // Persist title to library/dashboard chart — local-only update was lost on reload.
      void updateChartAndFetchData(selectedWidget.id, { title: next });
    }
  }, [selectedWidget, titleDraft, t, updateChartAndFetchData]);

  const ensureChartId = useCallback(async (): Promise<string | undefined> => {
    if (!selectedWidget) return undefined;
    if (selectedWidget.chartId) return String(selectedWidget.chartId);
    if (!user?.id) {
      message.warning(t('share_login_required'));
      return undefined;
    }
    const savedId = await saveChart(selectedWidget, user.id);
    if (!savedId) {
      message.error(t('share_save_required'));
      return undefined;
    }
    return savedId;
  }, [saveChart, selectedWidget, t, user?.id]);

  // Publishing/attaching a chart that's never been pointed at any data at
  // all just spreads its own empty "No data available. Configure the widget
  // in properties." placeholder into the feed - not meaningful content for
  // anyone else, regardless of what title it has. A chart mid-setup (some
  // query fields filled in, still refining) is left alone; this only catches
  // the "brand new widget, nothing touched yet" case.
  const hasConfiguredData = useCallback((widget: ChartDesignerWidget | null) => {
    return Boolean(widget?.chartQuery && Object.keys(widget.chartQuery).length > 0);
  }, []);

  const handleShareToFeed = useCallback(async () => {
    if (!selectedWidget) {
      message.warning(t('share_select_chart'));
      return;
    }
    if (!user?.id) {
      message.warning(t('share_login_required'));
      return;
    }
    if (!hasConfiguredData(selectedWidget)) {
      message.warning(t('share_needs_data'));
      return;
    }

    setPreparing(true);
    try {
      const chartId = await ensureChartId();
      if (!chartId) return;
      setPublishChartId(chartId);
      setPublishTitle(selectedWidget.title?.trim() || t('untitled_chart'));
      setPublishPreviewMetadata({
        previewType: selectedWidget.chartType,
        chartWidget: {
          chartType: selectedWidget.chartType,
          chartData: selectedWidget.chartData,
          chartOptions: selectedWidget.chartOptions,
          chartQuery: selectedWidget.chartQuery,
        },
        ...(selectedWidget.dashboardId ? { dashboardId: String(selectedWidget.dashboardId) } : {}),
      });
      setPublishSnapshotPayload(
        buildChartSnapshotPayload({
          title: selectedWidget.title?.trim() || t('untitled_chart'),
          chartWidget: {
            chartType: selectedWidget.chartType,
            chartData: selectedWidget.chartData,
            chartOptions: selectedWidget.chartOptions,
            chartQuery: selectedWidget.chartQuery,
          },
          sourcePath: '/chart-designer',
          chartId,
          dashboardId: selectedWidget.dashboardId ? String(selectedWidget.dashboardId) : undefined,
        }) as unknown as Record<string, unknown>,
      );
      setPublishCaptureSelector(`[data-widget-id="${selectedWidget.id}"]`);
      setPublishOpen(true);
    } catch (error) {
      message.error(formatFeedPublishError(error, t('share_save_required')));
    } finally {
      setPreparing(false);
    }
  }, [ensureChartId, hasConfiguredData, selectedWidget, t, user?.id]);

  /** A link teammates open in Aicser (signed in, under their own access). */
  const handleCopyLink = useCallback(async () => {
    setPreparing(true);
    try {
      const chartId = await ensureChartId();
      if (!chartId) return;
      await navigator.clipboard.writeText(`${window.location.origin}/chart-designer?chart=${encodeURIComponent(chartId)}`);
      message.success(t('link_copied'));
    } catch {
      message.error(tDash('copy_failed'));
    } finally {
      setPreparing(false);
    }
  }, [ensureChartId, t, tDash]);

  const handleShowEmbed = useCallback(async () => {
    if (!selectedWidget) {
      message.warning(t('share_select_chart'));
      return;
    }
    // An embed shows the saved chart, so save it first
    setPreparing(true);
    try {
      const chartId = await ensureChartId();
      if (chartId) setEmbedChartId(String(chartId));
    } finally {
      setPreparing(false);
    }
  }, [ensureChartId, selectedWidget, t]);

  const dispatchAddToDashboard = useCallback(() => {
    if (!selectedWidget?.chartId) return;
    window.dispatchEvent(
      new CustomEvent(ADD_TO_DASHBOARD_EVENT, { detail: { chartId: String(selectedWidget.chartId) } }),
    );
  }, [selectedWidget?.chartId]);

  const shareMenuItems: MenuProps['items'] = [
    {
      key: 'link',
      icon: <LinkOutlined />,
      label: menuItemWithDescription(t('copy_link'), t('copy_link_desc')),
      onClick: () => void handleCopyLink(),
    },
    {
      key: 'dashboard',
      icon: <DashboardOutlined />,
      label: t('add_to_dashboard'),
      disabled: !selectedWidget?.chartId,
      onClick: () => dispatchAddToDashboard(),
    },
    { type: 'divider' },
    {
      key: 'feed',
      icon: <ShareAltOutlined />,
      label: menuItemWithDescription(tf('share_to_feed'), tf('share_to_feed_desc')),
      onClick: () => void handleShareToFeed(),
    },
  ];

  const title = selectedWidget?.title?.trim() || t('untitled_chart');

  // Everything that isn't sharing: take the data or picture out, copy the chart, or remove it.
  const moreMenuItems: MenuProps['items'] = [
    {
      key: 'copy',
      icon: <CopyOutlined />,
      label: tDash('menu_copy_data'),
      disabled: !selectedWidget?.chartData,
      onClick: () => void handleDownload('copy'),
    },
    {
      key: 'download',
      icon: <DownloadOutlined />,
      label: tDash('menu_download'),
      disabled: !selectedWidget?.chartData,
      children: [
        { key: 'csv', icon: <FileTextOutlined />, label: tDash('menu_download_csv'), onClick: () => void handleDownload('csv') },
        { key: 'excel', icon: <FileExcelOutlined />, label: tDash('menu_download_excel'), onClick: () => void handleDownload('excel') },
        { key: 'png', icon: <FileImageOutlined />, label: tDash('menu_download_png'), onClick: () => void handleDownload('png') },
        { key: 'png-print', icon: <FileImageOutlined />, label: tDash('menu_download_png_print'), onClick: () => void handleDownload('png-print') },
        { key: 'svg', icon: <FileImageOutlined />, label: tDash('menu_download_svg'), onClick: () => void handleDownload('svg') },
      ],
    },
    { type: 'divider' },
    {
      key: 'duplicate',
      icon: <BlockOutlined />,
      label: t('duplicate_chart'),
      disabled: !selectedWidget,
      onClick: () => selectedWidget && duplicateWidget(selectedWidget.id),
    },
    {
      key: 'trash',
      icon: <DeleteOutlined />,
      danger: true,
      label: t('move_to_trash'),
      disabled: !selectedWidget?.chartId,
      onClick: () =>
        selectedWidget?.chartId &&
        window.dispatchEvent(new CustomEvent(TRASH_CHART_EVENT, { detail: { chartId: String(selectedWidget.chartId), title } })),
    },
  ];

  const handleDownload = async (key: string) => {
    if (!selectedWidget) return;
    const w = selectedWidget as any;
    try {
      if (key === 'copy') {
        const n = await copyChartData(w.chartData, w);
        if (n) message.success(tDash('data_copied', { count: n }));
        else message.info(tDash('view_table_empty'));
      } else if (key === 'csv') exportCSV(w.chartData, title, w);
      else if (key === 'excel') exportExcel(w.chartData, title, w);
      else if (key === 'png' || key === 'png-print' || key === 'svg') {
        await exportChartByWidget(w.id, title, key as 'png' | 'png-print' | 'svg', {
          description: chartDescription(w.chartOptions),
          source: chartSource(w.chartOptions),
        });
      }
    } catch {
      message.error(key === 'copy' ? tDash('copy_failed') : tDash('export_failed'));
    }
  };

  return (
    <>
      <div className="chart-designer-toolbar">
        {selectedWidget ? (
          // Title with its description underneath, as the chart reads on a dashboard.
          <div className="chart-designer-toolbar-meta">
            <Input
              className="chart-designer-toolbar-title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onPressEnter={(e) => {
                (e.target as HTMLInputElement).blur();
              }}
              placeholder={t('untitled_chart')}
              variant="borderless"
              maxLength={120}
            />
            <InlineText
              className="chart-designer-toolbar-description"
              value={typeof selectedWidget.chartOptions?.subtitle === 'string' ? selectedWidget.chartOptions.subtitle : ''}
              placeholder={tDash('inline_add_description')}
              editable
              multiline
              maxLength={500}
              onChange={(v) => emitWidgetOptionsPatch(String(selectedWidget.id), { subtitle: v || undefined })}
            />
          </div>
        ) : (
          <span className="chart-designer-toolbar-title chart-designer-toolbar-title--empty">
            {t('toolbar_no_selection')}
          </span>
        )}
        <div className="chart-designer-toolbar-actions">
          {selectedWidget && onViewChange ? (
            <Segmented
              size="small"
              value={view}
              onChange={(v) => onViewChange(v as 'chart' | 'data')}
              options={[
                { value: 'chart', icon: <Tooltip title={tDash('view_chart')}><BarChartOutlined aria-label={tDash('view_chart')} /></Tooltip> },
                { value: 'data', icon: <Tooltip title={tDash('view_data')}><TableOutlined aria-label={tDash('view_data')} /></Tooltip> },
              ]}
            />
          ) : null}
          {onPreview ? (
            <Tooltip title={t('full_screen')}>
              <Button size="small" type="text" icon={<FullscreenOutlined />} aria-label={t('full_screen')} onClick={onPreview} disabled={!selectedWidget} />
            </Tooltip>
          ) : null}
          <Dropdown menu={{ items: shareMenuItems }} trigger={['click']} disabled={!selectedWidget}>
            <Button size="small" icon={<ShareAltOutlined />} className="chart-designer-toolbar-share" disabled={!selectedWidget} loading={preparing || isSaving}>
              {t('share')}
            </Button>
          </Dropdown>
          {/* Publish: a public link and embed code anyone can open without signing in. */}
          <Tooltip title={t('publish_tooltip')}>
            <Button size="small" type="primary" icon={<GlobalOutlined />} disabled={!selectedWidget || !hasConfiguredData(selectedWidget)}
              onClick={() => void handleShowEmbed()}>
              {t('publish')}
            </Button>
          </Tooltip>
          <Dropdown menu={{ items: moreMenuItems }} trigger={['click']} disabled={!selectedWidget}>
            <Button size="small" type="text" icon={<MoreOutlined />} aria-label={t('more_actions')} disabled={!selectedWidget} />
          </Dropdown>
        </div>
      </div>

      {publishChartId && (
        <PublishToFeedModal
          open={publishOpen}
          assetType="chart"
          assetId={publishChartId}
          defaultTitle={publishTitle}
          previewMetadata={publishPreviewMetadata}
          snapshotPayload={publishSnapshotPayload}
          renderMode="snapshot"
          projectId={projectId}
          organizationId={organizationId}
          modalTitle={t('share_to_feed_modal_title')}
          captureSelector={publishCaptureSelector}
          onCancel={() => {
            setPublishOpen(false);
            setPublishChartId(undefined);
            setPublishPreviewMetadata(undefined);
            setPublishSnapshotPayload(undefined);
            setPublishCaptureSelector(undefined);
          }}
        />
      )}

      <EmbedDialog
        open={Boolean(embedChartId)}
        onClose={() => setEmbedChartId(null)}
        scope="chart"
        resourceId={embedChartId}
        name={title}
        title={t('publish_dialog_title', { name: title })}
        iframeHeight={400}
      />
    </>
  );
}

export default ChartDesignerToolbar;
