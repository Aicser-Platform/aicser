'use client';

import React, { useCallback } from 'react';
import { Button, Tooltip, message } from 'antd';
import { CopyOutlined, ShareAltOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { FeedItem } from '@/services/socialFeedService';
import { socialFeedService } from '@/services/socialFeedService';
import { buildDiscoverShareUrl, getStoredDiscoverReferral } from '@/hooks/discover/useDiscoverReferral';
import { useAuthStore } from '@/stores/useAuthStore';

type Props = {
  item: FeedItem;
  className?: string;
};

export function DiscoverDetailActions({ item, className }: Props) {
  const t = useTranslations('discover');
  const { user } = useAuthStore();

  const refHandle =
    user?.username?.trim() ||
    (user?.email?.includes('@') ? user.email.split('@')[0] : null);

  const handleCopyShare = useCallback(async () => {
    const url = buildDiscoverShareUrl(item.id, refHandle || getStoredDiscoverReferral());
    try {
      await navigator.clipboard.writeText(url);
      message.success(t('link_copied'));
      void socialFeedService.shareItem(item.id).catch(() => undefined);
    } catch {
      message.error(t('copy_failed'));
    }
  }, [item.id, refHandle, t]);

  const handleShare = useCallback(async () => {
    const url = buildDiscoverShareUrl(item.id, refHandle || getStoredDiscoverReferral());
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: item.title,
          text: item.description || item.title,
          url,
        });
        void socialFeedService.shareItem(item.id).catch(() => undefined);
        return;
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') {
          return;
        }
      }
    }
    await handleCopyShare();
  }, [handleCopyShare, item.description, item.id, item.title, refHandle]);

  return (
    <div className={`discover-detail-actions ${className ?? ''}`}>
      <Tooltip title={t('share_link')}>
        <Button
          type="default"
          shape="circle"
          icon={<ShareAltOutlined />}
          aria-label={t('share_link')}
          onClick={() => void handleShare()}
        />
      </Tooltip>
      <Tooltip title={t('copy_link')}>
        <Button
          type="default"
          shape="circle"
          icon={<CopyOutlined />}
          aria-label={t('copy_link')}
          onClick={() => void handleCopyShare()}
        />
      </Tooltip>
    </div>
  );
}

export default DiscoverDetailActions;
