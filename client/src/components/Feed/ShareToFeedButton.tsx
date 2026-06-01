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
}

const ShareToFeedButton: React.FC<ShareToFeedButtonProps> = ({
  draft,
  disabled,
  organizationId,
  projectId,
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
        chatPublish={{ conversationId: draft.conversationId, messageId: draft.messageId }}
        organizationId={organizationId}
        projectId={projectId}
        modalTitle={t('heading')}
        onCancel={() => setOpen(false)}
        onSuccess={() => setOpen(false)}
      />
    </>
  );
};

export default ShareToFeedButton;
