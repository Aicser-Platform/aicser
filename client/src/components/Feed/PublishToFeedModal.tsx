'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Drawer, Grid, Modal } from 'antd';
import { useTranslations } from 'next-intl';
import { assetPublishDraft } from '@/components/Feed/feedPublishDraft';
import { FeedPublishComposer } from '@/components/Feed/FeedPublishComposer';
import type { AssetType, PublishAssetResponse } from '@/services/socialFeedService';

export interface PublishToFeedModalProps {
  open: boolean;
  loading?: boolean;
  assetType: AssetType;
  assetId?: string;
  sourceQueryId?: string;
  defaultTitle?: string;
  defaultDescription?: string;
  defaultTags?: string[];
  previewMetadata?: Record<string, unknown>;
  snapshotPayload?: Record<string, unknown>;
  renderMode?: 'snapshot' | 'live';
  organizationId?: string;
  projectId?: string;
  chatPublish?: { conversationId: string; messageId: string };
  modalTitle?: string;
  /** CSS selector for the live element to screenshot for the feed card thumbnail. */
  captureSelector?: string;
  onCancel: () => void;
  onSuccess?: (result: PublishAssetResponse) => void;
}

const PublishToFeedModal: React.FC<PublishToFeedModalProps> = ({
  open,
  assetType,
  assetId,
  sourceQueryId,
  defaultTitle = '',
  defaultDescription = '',
  defaultTags = [],
  previewMetadata,
  snapshotPayload,
  renderMode = 'snapshot',
  organizationId,
  projectId,
  chatPublish,
  modalTitle,
  captureSelector,
  onCancel,
  onSuccess,
}) => {
  const t = useTranslations('feed_publish');
  const td = useTranslations('dashboard_tabs');
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [draftKey, setDraftKey] = useState(0);

  useEffect(() => {
    if (open) {
      setDraftKey((k) => k + 1);
    }
  }, [open, defaultTitle, assetId, sourceQueryId]);

  const publishDraft = useMemo(
    () =>
      assetPublishDraft({
        assetType,
        assetId,
        sourceQueryId,
        title: defaultTitle,
        description: defaultDescription,
        tags: defaultTags,
        previewMetadata,
        snapshotPayload,
        renderMode,
        chatPublish,
        captureSelector,
      }),
    [assetType, assetId, sourceQueryId, defaultTitle, defaultDescription, defaultTags, previewMetadata, snapshotPayload, renderMode, chatPublish, captureSelector],
  );

  const titleKey =
    assetType === 'dashboard'
      ? 'publish_dashboard'
      : assetType === 'chart'
        ? 'publish_chart'
        : assetType === 'query'
          ? 'publish_query'
          : 'publish_insight';

  const heading = modalTitle ?? t(titleKey);

  const composer = (
    <FeedPublishComposer
      key={draftKey}
      draft={publishDraft}
      layout="embedded"
      heading={heading}
      onCancel={onCancel}
      onSuccess={(result) => {
        onSuccess?.(result);
      }}
    />
  );

  if (isMobile) {
    return (
      <Drawer
        title={heading}
        placement="bottom"
        height="92vh"
        open={open}
        onClose={onCancel}
        destroyOnHidden
        className="feed-publish-drawer"
        styles={{ body: { padding: '12px 16px 24px' } }}
      >
        {composer}
      </Drawer>
    );
  }

  return (
    <Modal
      title={heading}
      open={open}
      footer={null}
      onCancel={onCancel}
      destroyOnHidden
      width={920}
      className="feed-publish-modal"
      styles={{ body: { padding: '8px 4px 16px', maxHeight: '75vh', overflowY: 'auto' } }}
    >
      {composer}
    </Modal>
  );
};

export default PublishToFeedModal;
