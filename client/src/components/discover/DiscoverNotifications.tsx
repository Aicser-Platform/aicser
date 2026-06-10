'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Dropdown, Empty } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { socialFeedService, type FeedNotificationItem } from '@/services/socialFeedService';
import { formatTimeAgo } from '@/services/socialFeedService';

export function DiscoverNotifications() {
  const t = useTranslations('discover');
  const [items, setItems] = useState<FeedNotificationItem[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await socialFeedService.getFeedNotifications({ unreadOnly: true, limit: 12 });
      setItems(res.items);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const unread = items.filter((n) => !n.isRead).length;

  const labelFor = (n: FeedNotificationItem) => {
    const name = n.actor?.name || t('someone');
    if (n.type === 'publish') return t('notif_publish', { name });
    if (n.type === 'follow') return t('notif_follow', { name });
    if (n.type === 'comment') return t('notif_comment', { name });
    if (n.type === 'reaction') return t('notif_reaction', { name });
    if (n.type === 'share') return t('notif_share', { name });
    return t('notif_default', { name });
  };

  const menu = {
    items: items.length
      ? items.map((n) => ({
          key: n.id,
          label: (
            <Link
              href={n.postId ? `/discover/${n.postId}` : '/feed'}
              className="discover-notif-item"
              onClick={() => {
                void socialFeedService.markNotificationRead(n.id).then(() => void load());
              }}
            >
              <span className="discover-notif-text">{labelFor(n)}</span>
              <span className="discover-notif-time">{formatTimeAgo(n.createdAt)}</span>
            </Link>
          ),
        }))
      : [{ key: 'empty', label: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('notif_empty')} /> }],
  };

  return (
    <Dropdown
      menu={menu}
      trigger={['click']}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
      overlayClassName="discover-notif-dropdown"
    >
      <Badge count={unread} size="small" offset={[-2, 2]}>
        <Button type="text" icon={<BellOutlined />} aria-label={t('notifications')} />
      </Badge>
    </Dropdown>
  );
}

export default DiscoverNotifications;
