'use client';

import React, { useCallback, useState } from 'react';
import { Button, message } from 'antd';
import {
  CopyOutlined,
  ExperimentOutlined,
  LoginOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const [remixing, setRemixing] = useState(false);

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

  const handleRemix = useCallback(async () => {
    if (!isAuthenticated) {
      router.push(`/login?next=${encodeURIComponent(`/discover/${item.id}`)}`);
      return;
    }
    setRemixing(true);
    try {
      const referral = getStoredDiscoverReferral() || undefined;
      const result = await socialFeedService.remixFeedPost(item.id, { referral_code: referral });
      message.success(t('remix_success'));
      router.push(result.open_path);
    } catch {
      message.error(t('remix_failed'));
    } finally {
      setRemixing(false);
    }
  }, [isAuthenticated, item.id, router, t]);

  return (
    <div className={`discover-detail-actions ${className ?? ''}`}>
      {isAuthenticated ? (
        <Button
          type="primary"
          icon={<ExperimentOutlined />}
          loading={remixing}
          onClick={() => void handleRemix()}
        >
          {t('remix_cta')}
        </Button>
      ) : (
        <Link href={`/login?next=${encodeURIComponent(`/discover/${item.id}`)}`}>
          <Button type="primary" icon={<LoginOutlined />}>
            {t('remix_sign_in')}
          </Button>
        </Link>
      )}
      <Button icon={<ShareAltOutlined />} onClick={() => void handleCopyShare()}>
        {t('share_link')}
      </Button>
      <Button icon={<CopyOutlined />} onClick={() => void handleCopyShare()}>
        {t('copy_link')}
      </Button>
    </div>
  );
}

export default DiscoverDetailActions;
