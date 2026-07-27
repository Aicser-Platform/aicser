'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Dropdown, Input, Modal, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import { ShareAltOutlined, CodeOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import PublishToFeedModal from '@/components/Feed/PublishToFeedModal';
import { buildChartSnapshotPayload } from '@/app/(dashboard)/feed/utils/buildFeedSnapshotPayload';
import { formatFeedPublishError } from '@/components/Feed/feedPublishUtils';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { EmbedCodePanel } from '@/components/embed/EmbedCodePanel';
import { useEmbedCode } from '@/hooks/useEmbedCode';
import type { ChartDesignerWidget } from '../stores/useChartDesignerStore';
import { useChartDesignerStore } from '../stores/useChartDesignerStore';

interface ChartDesignerToolbarProps {
  selectedWidget: ChartDesignerWidget | null;
}

export function ChartDesignerToolbar({ selectedWidget }: ChartDesignerToolbarProps) {
  const t = useTranslations('chart_designer');
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
  const updateWidget = useChartDesignerStore((s) => s.updateWidget);
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
      updateWidget(selectedWidget.id, { title: next });
    }
  }, [selectedWidget, titleDraft, t, updateWidget]);

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

  const handleShareToFeed = useCallback(async () => {
    if (!selectedWidget) {
      message.warning(t('share_select_chart'));
      return;
    }
    if (!user?.id) {
      message.warning(t('share_login_required'));
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
  }, [ensureChartId, selectedWidget, t, user?.id]);

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
      label: tf('share_to_feed'),
      onClick: () => void handleShareToFeed(),
    },
    {
      key: 'embed',
      icon: <CodeOutlined />,
      label: te('embed_get_code'),
      onClick: () => void handleShowEmbed(),
    },
  ];

  const title = selectedWidget?.title?.trim() || t('untitled_chart');

  return (
    <>
      <div className="chart-designer-toolbar">
        {selectedWidget ? (
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
        ) : (
          <span className="chart-designer-toolbar-title chart-designer-toolbar-title--empty">
            {t('toolbar_no_selection')}
          </span>
        )}
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
          onSuccess={() => {
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
