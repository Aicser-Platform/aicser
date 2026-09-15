'use client';

import React, { useMemo, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { ShareAltOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import PublishToFeedModal from '@/components/Feed/PublishToFeedModal';
import { chatDraftToPublishDraft } from '@/components/Feed/feedPublishDraft';
import type { ChatFeedDraft } from './chatFeedDraft';
import { socialFeedService } from '@/services/socialFeedService';

interface ShareToFeedButtonProps {
  draft: ChatFeedDraft;
  disabled?: boolean;
  organizationId?: string;
  projectId?: string;
  /** CSS selector for the live element to screenshot for the feed card thumbnail —
   * e.g. ".dashboard-container" (DashboardTabs.tsx), ".executive-report" (the
   * report page). Without this, PublishToFeedModal has nothing to capture and the
   * post gets no thumbnail at all — falling back to a bare placeholder instead of
   * the actual visual other asset types show in the feed. */
  captureSelector?: string;
  /** Caps the thumbnail capture height — see feedPublishDraft.ts's doc comment. */
  captureMaxHeightPx?: number;
}

const ShareToFeedButton: React.FC<ShareToFeedButtonProps> = ({
  draft,
  disabled,
  organizationId,
  projectId,
  captureSelector,
  captureMaxHeightPx,
}) => {
  const t = useTranslations('feed_publish_page');
  const [open, setOpen] = useState(false);

  const publishDraft = useMemo(() => chatDraftToPublishDraft(draft), [draft]);

  if (!draft.conversationId) return null;

  const handleShare = () => {
    void socialFeedService
      .saveChatFeedDraft({
        conversation_id: draft.conversationId,
        message_id: draft.messageId,
        draft: draft as unknown as Record<string, unknown>,
      })
      .finally(() => setOpen(true));
  };

  return (
    <>
      <Tooltip title={t('share_tooltip')}>
        <Button
          size="small"
          type="text"
          icon={<ShareAltOutlined />}
          className="message-feedback-btn"
          disabled={disabled}
          aria-label={t('share_tooltip')}
          onClick={handleShare}
        />
      </Tooltip>
      <PublishToFeedModal
        open={open}
        assetType="insight"
        defaultTitle={draft.title}
        defaultDescription={draft.excerpt || draft.description}
        previewMetadata={draft.previewMetadata}
        snapshotPayload={draft.snapshotPayload}
        renderMode="snapshot"
        captureSelector={captureSelector}
        captureMaxHeightPx={captureMaxHeightPx}
        chatPublish={{ conversationId: draft.conversationId, messageId: draft.messageId }}
        organizationId={organizationId}
        projectId={projectId}
        modalTitle={t('heading')}
        onCancel={() => setOpen(false)}
      />
    </>
  );
};

export default ShareToFeedButton;
