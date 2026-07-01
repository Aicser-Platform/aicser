import React from 'react';
import Link from 'next/link';
import { Avatar, Button, Dropdown, Modal, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
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
  /** Link author name to public profile, e.g. `/discover/author`. */
  authorProfileBasePath?: string;
  /** Grid-card header: smaller avatar, author title in place of the visibility tag. */
  compact?: boolean;
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
  authorProfileBasePath,
  compact = false,
}) => {
  const t = useTranslations('feed');
  const publishedAtMs = new Date(item.publishedAt).getTime();
  const lastActivityAtMs = new Date(item.lastActivityAt).getTime();
  const hasUpdates =
    Number.isFinite(publishedAtMs) &&
    Number.isFinite(lastActivityAtMs) &&
    lastActivityAtMs - publishedAtMs > UPDATE_THRESHOLD_MS;
  const activityTime = formatTimeAgo(hasUpdates ? item.lastActivityAt : item.publishedAt);
  const authorProfileHref =
    authorProfileBasePath && item.author.username
      ? `${authorProfileBasePath}/${encodeURIComponent(item.author.username.replace(/^@/, ''))}`
      : null;
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

  const authorTitle = item.author.title?.trim();
  const showAuthorTitle = compact && Boolean(authorTitle);

  return (
    <div
      className={`flex items-start justify-between border-b border-[var(--ant-color-border-secondary)] ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}
    >
      {/* Left: avatar + author info */}
      <div className="flex items-center gap-2.5">
        <Avatar
          className="bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)] shrink-0 font-medium"
          size={compact ? 32 : 36}
          src={item.author.avatarUrl}
        >
          {item.author.name.charAt(0).toUpperCase()}
        </Avatar>
        <div className="flex flex-col min-w-0">
          {authorProfileHref ? (
            <Link href={authorProfileHref} onClick={handleStopPropagation} className="truncate">
              <Text strong className="text-sm text-[var(--ant-color-text)] leading-tight hover:text-[var(--ant-color-primary)]">
                {item.author.name}
              </Text>
            </Link>
          ) : (
            <Text strong className="text-sm text-[var(--ant-color-text)] leading-tight truncate">
              {item.author.name}
            </Text>
          )}
          <div className="flex items-center text-xs text-[var(--ant-color-text-tertiary)] mt-0.5 gap-1.5 flex-wrap">
            {showAuthorTitle ? (
              <span className="truncate">{authorTitle}</span>
            ) : null}
            {showAuthorTitle ? <span className="opacity-40">&bull;</span> : null}
            <span>{activityTime}</span>
            {!showAuthorTitle && (
              <>
                <span className="opacity-40">&bull;</span>
                <Tag
                  className="m-0 rounded border-0 text-[10px] font-medium leading-none py-0 px-1.5"
                  color={visibilityColors[item.visibility]}
                >
                  {visibilityLabel}
                </Tag>
              </>
            )}
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

      {/* Right: follow + more — grid cards keep Follow in the "..." menu only, for a clean header */}
      <div className="flex items-center gap-2">
        {canFollow && !compact && (
          <Button
            size="small"
            type="text"
            className={`rounded-full border px-3 text-xs font-semibold transition-colors ${isFollowingAuthor ? 'border-[var(--ant-color-border)] text-[var(--ant-color-text-secondary)] hover:border-[var(--ant-color-border-secondary)]' : 'border-[var(--ant-color-border)] text-[var(--ant-color-text-secondary)] hover:border-[var(--ant-color-primary)] hover:text-[var(--ant-color-primary)]'}`}
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
