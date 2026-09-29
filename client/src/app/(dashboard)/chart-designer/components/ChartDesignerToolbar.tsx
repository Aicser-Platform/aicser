'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Dropdown, Input, Modal, Segmented, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  ShareAltOutlined,
  CodeOutlined,
  DashboardOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileTextOutlined,
  BarChartOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { ADD_TO_DASHBOARD_EVENT } from './chartDesignerEvents';
import { useTranslations } from 'next-intl';
import PublishToFeedModal from '@/components/Feed/PublishToFeedModal';
import { buildChartSnapshotPayload } from '@/app/(dashboard)/feed/utils/buildFeedSnapshotPayload';
import { formatFeedPublishError } from '@/components/Feed/feedPublishUtils';
import { menuItemWithDescription } from '@/components/Feed/MenuItemWithDescription';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { EmbedCodePanel } from '@/components/embed/EmbedCodePanel';
import { useEmbedCode } from '@/hooks/useEmbedCode';
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
}

export function ChartDesignerToolbar({ selectedWidget, view = 'chart', onViewChange }: ChartDesignerToolbarProps) {
  const t = useTranslations('chart_designer');
  const tDash = useTranslations('dashboards');
  const tf = useTranslations('feed_publish');
  const te = useTranslations('embed_modal');

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
  const { createEmbedCode, loading: embedLoading } = useEmbedCode();

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishChartId, setPublishChartId] = useState<string | undefined>();
  const [publishTitle, setPublishTitle] = useState('');
  const [publishPreviewMetadata, setPublishPreviewMetadata] = useState<Record<string, unknown> | undefined>();
  const [publishSnapshotPayload, setPublishSnapshotPayload] = useState<Record<string, unknown> | undefined>();
  const [publishCaptureSelector, setPublishCaptureSelector] = useState<string | undefined>();
  const [preparing, setPreparing] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedUrl, setEmbedUrl] = useState('');
  const [embedToken, setEmbedToken] = useState<string | undefined>();
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

  const handleShowEmbed = useCallback(async () => {
    if (!selectedWidget) {
      message.warning(t('share_select_chart'));
      return;
    }
    setEmbedOpen(true);
    setEmbedUrl('');
    setEmbedToken(undefined);
    setPreparing(true);
    try {
      const chartId = await ensureChartId();
      if (!chartId) {
        setEmbedOpen(false);
        return;
      }
      const title = selectedWidget.title?.trim() || t('untitled_chart');
      const result = await createEmbedCode({
        scope: 'chart',
        resourceId: chartId,
        name: `Embed: ${title}`,
      });
      setEmbedUrl(result.embedUrl);
      setEmbedToken(result.token);
    } finally {
      setPreparing(false);
    }
  }, [createEmbedCode, ensureChartId, selectedWidget, t]);

  const shareMenuItems: MenuProps['items'] = [
    {
      key: 'feed',
      icon: <ShareAltOutlined />,
      label: menuItemWithDescription(tf('share_to_feed'), tf('share_to_feed_desc')),
      onClick: () => void handleShareToFeed(),
    },
    {
      key: 'embed',
      icon: <CodeOutlined />,
      label: te('embed_get_code'),
      onClick: () => void handleShowEmbed(),
    },
    // Taking the chart out lives with sharing it (Canva / Datawrapper): one menu, not two.
    { type: 'divider' },
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
  ];

  const title = selectedWidget?.title?.trim() || t('untitled_chart');

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
          <div className="chart-designer-toolbar-heading">
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
              onChange={(v) => emitWidgetOptionsPatch(String(selectedWidget.id), { subtitle: v || undefined })}
            />
          </div>
        ) : (
          <span className="chart-designer-toolbar-title chart-designer-toolbar-title--empty">
            {t('toolbar_no_selection')}
          </span>
        )}
        {/* See the numbers behind the chart without leaving it (Power BI "show as table"). */}
        {selectedWidget && onViewChange ? (
          <Segmented
            size="small"
            value={view}
            onChange={(v) => onViewChange(v as 'chart' | 'data')}
            options={[
              { label: tDash('view_chart'), value: 'chart', icon: <BarChartOutlined /> },
              { label: tDash('view_data'), value: 'data', icon: <TableOutlined /> },
            ]}
          />
        ) : null}
        {/* The next step after building a chart, one click away (the library "⋮" menu opens the
            same dialog). */}
        <Button
          size="small"
          icon={<DashboardOutlined />}
          disabled={!selectedWidget?.chartId}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent(ADD_TO_DASHBOARD_EVENT, { detail: { chartId: String(selectedWidget?.chartId) } }),
            )
          }
        >
          {t('add_to_dashboard')}
        </Button>
        <Dropdown menu={{ items: shareMenuItems }} trigger={['click']} disabled={!selectedWidget}>
          <Tooltip title={selectedWidget ? t('share_menu_tooltip') : t('share_select_chart')}>
            <Button
              type="text"
              size="small"
              icon={<ShareAltOutlined />}
              className="chart-designer-toolbar-share"
              disabled={!selectedWidget}
              loading={preparing || isSaving}
            >
              {t('share')}
            </Button>
          </Tooltip>
        </Dropdown>
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

      <Modal
        title={te('embed_get_code')}
        open={embedOpen}
        onCancel={() => setEmbedOpen(false)}
        width={720}
        footer={null}
        destroyOnHidden
      >
        <EmbedCodePanel
          embedUrl={embedUrl}
          loading={embedLoading || preparing}
          token={embedToken}
          title={title}
          iframeHeight={400}
        />
      </Modal>
    </>
  );
}

export default ChartDesignerToolbar;
