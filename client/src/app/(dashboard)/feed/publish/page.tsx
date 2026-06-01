'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import { Empty, Spin } from 'antd';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import ShareInsightComposer from '@/components/Feed/ShareInsightComposer';
import { readChatFeedDraft, type ChatFeedDraft } from '@/components/Feed/chatFeedDraft';
import { socialFeedService } from '@/services/socialFeedService';
import '../styles.css';

export default function FeedPublishPage() {
  const t = useTranslations('feed_publish_page');
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get('conversation') || searchParams.get('conversationId') || '';
  const messageId = searchParams.get('message') || searchParams.get('messageId') || '';

  const [draft, setDraft] = useState<ChatFeedDraft | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!conversationId || !messageId) {
      setReady(true);
      return;
    }

    let active = true;
    void (async () => {
      try {
        const server = await socialFeedService.getChatFeedDraft(conversationId, messageId);
        if (!active) return;
        if (server.draft && Object.keys(server.draft).length > 0) {
          setDraft(server.draft as unknown as ChatFeedDraft);
        } else {
          setDraft(readChatFeedDraft(conversationId, messageId));
        }
      } catch {
        if (active) setDraft(readChatFeedDraft(conversationId, messageId));
      } finally {
        if (active) setReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [conversationId, messageId]);

  return (
    <DashboardPageShell>
      <DashboardPageHeader title={t('page_title')} />
      <div className="feed-publish-page feed-publish-page--mobile">
        {!ready ? (
          <div className="feed-publish-loading">
            <Spin />
          </div>
        ) : !conversationId || !messageId || !draft ? (
          <Empty
            description={t('missing_draft')}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <button type="button" className="feed-publish-empty-back" onClick={() => router.push('/chat')}>
              {t('back_to_chat')}
            </button>
          </Empty>
        ) : (
          <ShareInsightComposer
            draft={draft}
            onBack={() => router.push('/chat')}
          />
        )}
      </div>
    </DashboardPageShell>
  );
}
