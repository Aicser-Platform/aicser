import React from 'react';
import { Avatar, Button, Dropdown, Modal, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { GlobalOutlined, MoreOutlined } from '@ant-design/icons';
import type { FeedItem } from '@/services/socialFeedService';
import { formatTimeAgo } from '@/services/socialFeedService';
import { approvalColors, visibilityColors } from './constants';
import { useTranslations } from 'next-intl';

const { Text } = Typography;
const UPDATE_THRESHOLD_MS = 5 * 60 * 1000;

interface FeedCardHeaderProps {
  item: FeedItem;
  visibilityLabel: string;
  canFollow: boolean;
  isFollowingAuthor: boolean;
  followPending?: boolean;
  deletePending?: boolean;
  onToggleFollow?: () => void;
  onOpenPost?: () => void;
  onCopyLink?: () => void;
  onDeletePost?: () => void;
}

const FeedCardHeader: React.FC<FeedCardHeaderProps> = ({
  item,
  visibilityLabel,
  canFollow,
  isFollowingAuthor,
  followPending = false,
  deletePending = false,
  onToggleFollow,
  onOpenPost,
  onCopyLink,
  onDeletePost,
}) => {
  const t = useTranslations('feed');
  const publishedAtMs = new Date(item.publishedAt).getTime();
  const lastActivityAtMs = new Date(item.lastActivityAt).getTime();
  const hasUpdates =
    Number.isFinite(publishedAtMs) &&
    Number.isFinite(lastActivityAtMs) &&
    lastActivityAtMs - publishedAtMs > UPDATE_THRESHOLD_MS;
  const activityTime = formatTimeAgo(hasUpdates ? item.lastActivityAt : item.publishedAt);
  const handleStopPropagation = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };
  const menuItems: MenuProps['items'] = [
    { key: 'open', label: t('open_post') },
    { key: 'copy', label: t('copy_link') },
    ...(canFollow
      ? [
          {
            key: 'follow',
            label: isFollowingAuthor ? t('unfollow_author') : t('follow_author'),
          },
        ]
      : []),
    ...(onDeletePost ? [{ type: 'divider' as const }, { key: 'delete', danger: true, label: t('delete_post') }] : []),
  ];

  return (
    <div className="flex items-start justify-between p-4 sm:p-5 border-b border-[var(--ant-color-border-secondary)]">
      {/* Left: avatar + author info */}
      <div className="flex items-center gap-3">
        <Avatar
          className="bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)] shrink-0 font-medium"
          size={44}
          src={item.author.avatarUrl}
        >
          {item.author.name.charAt(0).toUpperCase()}
        </Avatar>
        <div className="flex flex-col min-w-0">
          <Text strong className="text-[15px] text-[var(--ant-color-text)] leading-tight truncate">
            {item.author.name}
          </Text>
          {(item.author.title || item.author.username) && (
            <div className="flex items-center text-[13px] text-[var(--ant-color-text-secondary)] mt-0.5 truncate">
              {item.author.title && <span>{item.author.title}</span>}
              {item.author.title && item.author.username && <span className="mx-1.5 opacity-50">&bull;</span>}
              {item.author.username && <span>@{item.author.username}</span>}
            </div>
          )}
          <div className="flex items-center text-xs text-[var(--ant-color-text-tertiary)] mt-1 gap-1.5 flex-wrap">
            <span className="flex items-center gap-1">
              <GlobalOutlined title={visibilityLabel} />
              {activityTime}
            </span>
            <span className="opacity-50">&bull;</span>
            <Tag
              className="m-0 rounded border-0 text-[11px] font-medium tracking-wide shadow-sm"
              color={visibilityColors[item.visibility]}
            >
              {visibilityLabel}
            </Tag>
            {hasUpdates && (
              <Tag className="m-0 rounded border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-layout)] text-[var(--ant-color-text-secondary)] text-[11px] font-medium tracking-wide shadow-sm">
                {t('updated')}
              </Tag>
            )}
            {item.approvalStatus !== 'approved' && (
              <Tag
                className="m-0 rounded border-0 text-[11px] font-medium tracking-wide shadow-sm"
                color={approvalColors[item.approvalStatus]}
              >
                {item.approvalStatus}
              </Tag>
            )}
          </div>
        </div>
      </div>

      {/* Right: follow + more */}
      <div className="flex items-center gap-2">
        {canFollow && (
          <Button
            size="small"
            className={`rounded-full px-3 text-xs font-semibold ${isFollowingAuthor ? 'bg-[var(--ant-color-bg-layout)] text-[var(--ant-color-text-secondary)] border-transparent' : 'text-[var(--ant-color-primary)] hover:text-[var(--ant-color-primary-hover)] bg-[var(--ant-color-primary-bg)] border-transparent'}`}
            loading={followPending}
            disabled={followPending || deletePending}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFollow?.();
            }}
          >
            {isFollowingAuthor ? t('scope_following') : t('follow_button_plus')}
          </Button>
        )}
        <Dropdown
          trigger={['click']}
          overlayClassName="min-w-[160px] shadow-lg rounded-lg overflow-hidden py-1"
          menu={{
            items: menuItems,
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              if (key === 'open') {
                onOpenPost?.();
                return;
              }
              if (key === 'copy') {
                onCopyLink?.();
                return;
              }
              if (key === 'follow') {
                onToggleFollow?.();
                return;
              }
              if (key === 'delete' && onDeletePost) {
                Modal.confirm({
                  title: t('delete_post_confirm_title'),
                  content: t('delete_post_confirm_content'),
                  okText: t('delete'),
                  okType: 'danger',
                  cancelText: t('cancel'),
                  onOk: () => onDeletePost(),
                });
              }
            },
          }}
        >
          <Button
            type="text"
            className="text-[var(--ant-color-text-secondary)] hover:bg-[var(--ant-color-bg-layout)] rounded-full w-8 h-8 flex items-center justify-center p-0"
            disabled={deletePending}
            onClick={handleStopPropagation}
          >
            <MoreOutlined className="text-lg rotate-90" />
          </Button>
        </Dropdown>
      </div>
    </div>
  );
};

export default FeedCardHeader;
