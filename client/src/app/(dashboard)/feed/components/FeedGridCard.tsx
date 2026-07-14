'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Avatar, Button, Dropdown, Modal, Popover, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  BookOutlined,
  CheckCircleFilled,
  HeartOutlined,
  LinkOutlined,
  MessageOutlined,
  MoreOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { socialFeedService, formatTimeAgo } from '@/services/socialFeedService';
import type { FeedItem, ReactionType } from '@/services/socialFeedService';
import { assetTypeLabelKey, resolveFeedPostSummary } from '@/components/Feed/feedPostDisplay';
import { FeedPreviewEmpty } from './FeedPreviewEmpty';
import { reactionOptions } from './FeedCard/constants';
import { resolveBackendMediaUrl } from '@/utils/mediaUrl';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';

interface FeedGridCardProps {
  item: FeedItem;
  onReact?: (itemId: string, reaction: ReactionType) => Promise<void> | void;
  onSave?: (itemId: string) => Promise<void> | void;
  onToggleFollow?: (itemId: string, authorId: string) => Promise<void> | void;
  onDeleteItem?: (itemId: string) => Promise<void> | void;
  interactionState?: {
    reacting?: boolean;
    saving?: boolean;
    following?: boolean;
    deleting?: boolean;
  };
  highlighted?: boolean;
  /** Detail link base — default `/feed` for app feed; `/discover` for public. */
  detailBasePath?: string;
}

const normalizeHandle = (handle?: string) => handle?.trim().replace(/^@/, '').toLowerCase() || '';

const REACTION_PALETTE: Record<ReactionType, { color: string; softBg: string }> = {
  like: { color: '#1877F2', softBg: 'rgba(24, 119, 242, 0.12)' },
  applause: { color: '#2E8B57', softBg: 'rgba(46, 139, 87, 0.14)' },
  celebrate: { color: '#6F58B0', softBg: 'rgba(111, 88, 176, 0.14)' },
  love: { color: '#D9643A', softBg: 'rgba(217, 100, 58, 0.14)' },
  insightful: { color: '#D9A321', softBg: 'rgba(217, 163, 33, 0.16)' },
  funny: { color: '#18AFC6', softBg: 'rgba(24, 175, 198, 0.14)' },
};

/**
 * Single self-contained feed card for the grid view — header, title/description,
 * thumbnail, and a lean action row, all in one component (no Header/Body/Actions
 * split). Comments live on the detail page, not inline here.
 */
const FeedGridCard: React.FC<FeedGridCardProps> = ({
  item,
  onReact,
  onSave,
  onToggleFollow,
  onDeleteItem,
  interactionState,
  highlighted = false,
  detailBasePath = '/feed',
}) => {
  const t = useTranslations('feed');
  const ta = useTranslations('feed_card_actions');
  const router = useRouter();
  const { user } = useAuth();

  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false);
  const [isSharePopoverOpen, setIsSharePopoverOpen] = useState(false);
  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const closePickerTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const reactionPickerRef = useRef<HTMLDivElement | null>(null);

  const reacting = Boolean(interactionState?.reacting);
  const saving = Boolean(interactionState?.saving);
  const deleting = Boolean(interactionState?.deleting);
  const detailPath = `${detailBasePath}/${item.id}`;

  // Compare by username too: author.id can come from a different identity source
  // than the session user.id for legacy/seeded posts, which otherwise leaks a
  // "Follow" action onto the viewer's own posts.
  const isPostOwner =
    !!user &&
    (item.author?.id === user.id ||
      (!!user.username && normalizeHandle(item.author?.username) === normalizeHandle(user.username)));
  const canFollow = !!onToggleFollow && !!user && !!item.author?.id && !isPostOwner;
  const isFollowingAuthor = Boolean(item.userInteraction?.isFollowingAuthor);

  const currentReaction = item.userInteraction.reaction;
  const selectedReaction = currentReaction ? reactionOptions.find((option) => option.key === currentReaction) : null;
  const isBookmarked = item.userInteraction.isBookmarked;
  const assetTypeLabel = t(assetTypeLabelKey(item.assetType) as 'insights_type');
  const authorTitle = item.author.title?.trim();
  const description = useMemo(() => resolveFeedPostSummary(item), [item]);
  const thumbnailUrl = resolveBackendMediaUrl(item.asset.thumbnailUrl);

  const handleOpen = useCallback(() => router.push(detailPath), [router, detailPath]);
  const handlePrefetch = useCallback(() => router.prefetch(detailPath), [router, detailPath]);
  const handleToggleFollow = useCallback(() => {
    if (!item.author?.id || !onToggleFollow) return;
    onToggleFollow(item.id, item.author.id);
  }, [item.author?.id, item.id, onToggleFollow]);
  const handleDeleteItem = useCallback(() => {
    if (!onDeleteItem) return;
    Modal.confirm({
      title: t('delete_post_confirm_title'),
      content: t('delete_post_confirm_content'),
      okText: t('delete'),
      okType: 'danger',
      cancelText: t('cancel'),
      onOk: () => onDeleteItem(item.id),
    });
  }, [item.id, onDeleteItem, t]);

  const getShareUrl = useCallback(() => {
    if (typeof window === 'undefined') return detailPath;
    return new URL(detailPath, window.location.origin).toString();
  }, [detailPath]);

  const handleCopyLink = useCallback(
    async (event?: React.MouseEvent<HTMLElement>) => {
      event?.stopPropagation();
      try {
        const url = getShareUrl();
        await navigator.clipboard.writeText(url);
        void socialFeedService.shareItem(item.id);
        setIsLinkCopied(true);
        message.success(t('link_copied'));
        window.setTimeout(() => setIsLinkCopied(false), 1700);
      } catch (error) {
        message.error(error instanceof Error ? error.message : t('unable_copy_link'));
      }
    },
    [getShareUrl, item.id, t]
  );

  const handleShareToLinkedIn = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const url = encodeURIComponent(getShareUrl());
      window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, '_blank', 'noopener,noreferrer');
      void socialFeedService.shareItem(item.id);
      setIsSharePopoverOpen(false);
    },
    [getShareUrl, item.id]
  );

  const handleShareToX = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const url = encodeURIComponent(getShareUrl());
      const text = encodeURIComponent(item.title);
      window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, '_blank', 'noopener,noreferrer');
      void socialFeedService.shareItem(item.id);
      setIsSharePopoverOpen(false);
    },
    [getShareUrl, item.id, item.title]
  );

  const clearReactionCloseTimer = useCallback(() => {
    if (closePickerTimerRef.current !== null) {
      window.clearTimeout(closePickerTimerRef.current);
      closePickerTimerRef.current = null;
    }
  }, []);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const closeReactionPicker = useCallback(() => {
    clearReactionCloseTimer();
    setIsReactionPickerOpen(false);
  }, [clearReactionCloseTimer]);

  const openReactionPicker = useCallback(() => {
    clearReactionCloseTimer();
    setIsReactionPickerOpen(true);
  }, [clearReactionCloseTimer]);

  const scheduleReactionPickerClose = useCallback(() => {
    clearReactionCloseTimer();
    closePickerTimerRef.current = window.setTimeout(() => setIsReactionPickerOpen(false), 140);
  }, [clearReactionCloseTimer]);

  const handleReactionSelect = useCallback(
    (reaction: ReactionType) => {
      void onReact?.(item.id, reaction);
      closeReactionPicker();
    },
    [closeReactionPicker, item.id, onReact]
  );

  const handleReactionPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== 'touch' || reacting) return;
      clearLongPressTimer();
      longPressTimerRef.current = window.setTimeout(() => setIsReactionPickerOpen(true), 260);
    },
    [clearLongPressTimer, reacting]
  );

  useEffect(() => {
    return () => {
      clearReactionCloseTimer();
      clearLongPressTimer();
    };
  }, [clearReactionCloseTimer, clearLongPressTimer]);

  useEffect(() => {
    if (!isReactionPickerOpen) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!reactionPickerRef.current?.contains(target)) closeReactionPicker();
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [isReactionPickerOpen, closeReactionPicker]);

  const stopPropagation = (event: React.MouseEvent<HTMLElement>) => event.stopPropagation();

  const menuItems: MenuProps['items'] = [
    { key: 'open', label: t('open_post') },
    { key: 'copy', label: t('copy_link') },
    ...(canFollow ? [{ key: 'follow', label: isFollowingAuthor ? t('unfollow_author') : t('follow_author') }] : []),
    ...(isPostOwner && onDeleteItem
      ? [{ type: 'divider' as const }, { key: 'delete', danger: true, label: t('delete_post') }]
      : []),
  ];

  const authorProfileHref =
    detailBasePath === '/discover' && item.author.username
      ? `/discover/author/${encodeURIComponent(item.author.username.replace(/^@/, ''))}`
      : null;

  const shareMenuContent = (
    <div
      className="flex flex-col min-w-[200px] text-sm overflow-hidden rounded-xl bg-[var(--ant-color-bg-elevated)]"
      onClick={stopPropagation}
    >
      <button
        type="button"
        className={`flex items-center gap-2.5 px-4 py-3 text-left font-medium transition-colors ${isLinkCopied ? 'bg-[var(--ant-color-success-bg)] text-[var(--ant-color-success)]' : 'text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)]'}`}
        onClick={handleCopyLink}
      >
        {isLinkCopied ? <CheckCircleFilled className="text-lg" /> : <LinkOutlined className="text-lg" />}
        <span>{isLinkCopied ? t('link_copied') : t('copy_link')}</span>
      </button>
      <div className="h-px bg-[var(--ant-color-border-secondary)] w-full" />
      <button
        type="button"
        className="px-4 py-3 text-left font-medium text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)] transition-colors"
        onClick={handleShareToLinkedIn}
      >
        {ta('share_to_linkedin')}
      </button>
      <button
        type="button"
        className="px-4 py-3 text-left font-medium text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)] transition-colors"
        onClick={handleShareToX}
      >
        {ta('share_to_x')}
      </button>
    </div>
  );

  return (
    <div id={`feed-post-${item.id}`} className="h-full">
      <div
        className={`flex h-full flex-col bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border-secondary)] rounded-xl shadow-sm hover:shadow-md overflow-hidden transition-all duration-300 ${
          highlighted ? 'ring-2 ring-[var(--ant-color-primary)] bg-[var(--ant-color-primary-bg)]' : ''
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-[var(--ant-color-border-secondary)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar
              size={32}
              src={item.author.avatarUrl}
              className="bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)] shrink-0 font-medium"
            >
              {item.author.name.charAt(0).toUpperCase()}
            </Avatar>
            <div className="flex flex-col min-w-0">
              {authorProfileHref ? (
                <Link href={authorProfileHref} onClick={stopPropagation} className="truncate">
                  <span className="text-sm font-semibold text-[var(--ant-color-text)] leading-tight hover:text-[var(--ant-color-primary)]">
                    {item.author.name}
                  </span>
                </Link>
              ) : (
                <span className="text-sm font-semibold text-[var(--ant-color-text)] leading-tight truncate">
                  {item.author.name}
                </span>
              )}
              <span className="text-xs text-[var(--ant-color-text-tertiary)] truncate">
                {authorTitle ? `${authorTitle} • ` : ''}
                {formatTimeAgo(item.lastActivityAt || item.publishedAt)}
              </span>
            </div>
          </div>

          <Dropdown
            trigger={['click']}
            overlayClassName="min-w-[160px] shadow-lg rounded-lg overflow-hidden py-1"
            menu={{
              items: menuItems,
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key === 'open') handleOpen();
                else if (key === 'copy') void handleCopyLink();
                else if (key === 'follow') handleToggleFollow();
                else if (key === 'delete') handleDeleteItem();
              },
            }}
          >
            <Button
              type="text"
              className="text-[var(--ant-color-text-secondary)] hover:bg-[var(--ant-color-bg-layout)] rounded-full w-7 h-7 flex items-center justify-center p-0 shrink-0"
              disabled={deleting}
              onClick={stopPropagation}
            >
              <MoreOutlined className="text-base rotate-90" />
            </Button>
          </Dropdown>
        </div>

        {/* Flexible content: title/description + thumbnail + tags grow to fill the row's height */}
        <div className="flex flex-1 flex-col">
          {/* Title + description — fixed 2-line slots so cards line up regardless of actual length */}
          <div className="flex flex-col gap-1 px-3 py-2">
            <p className="m-0 line-clamp-2 min-h-[2.5rem] text-lg font-semibold leading-[1.25rem] text-[var(--ant-color-text)]">
              {item.title}
            </p>
            {description && (
              <p className="m-0 line-clamp-2 min-h-[2.5rem] text-sm leading-[1.25rem] text-[var(--ant-color-text-secondary)]">
                {description}
              </p>
            )}
          </div>

          {/* Thumbnail */}
          <div className="px-3 pb-2.5">
            <div
              className="relative aspect-video w-full overflow-hidden rounded-lg bg-[var(--ant-color-bg-layout)] cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={handleOpen}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleOpen();
                }
              }}
              aria-label={t('open_post')}
            >
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt={item.title}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <FeedPreviewEmpty label={t('snapshot_unavailable')} compact />
              )}
              <div className="absolute right-2 top-2 z-10">
                <span className="rounded-full bg-[var(--ant-color-bg-elevated)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ant-color-text-secondary)] shadow-sm">
                  {assetTypeLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Tags */}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5">
              {item.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[var(--ant-color-fill-tertiary)] px-2.5 py-0.5 text-xs text-[var(--ant-color-text-secondary)]"
                >
                  {tag}
                </span>
              ))}
              {item.tags.length > 4 && (
                <span className="rounded-full bg-[var(--ant-color-fill-tertiary)] px-2.5 py-0.5 text-xs text-[var(--ant-color-text-tertiary)]">
                  +{item.tags.length - 4}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Footer actions — pinned to the bottom of the card */}
        <div
          className="flex items-center justify-between gap-3 px-3 py-2 border-t border-[var(--ant-color-border-secondary)]"
          onClick={stopPropagation}
        >
          <div className="flex items-center gap-3">
            <div
              ref={reactionPickerRef}
              className="relative"
              onMouseEnter={openReactionPicker}
              onMouseLeave={scheduleReactionPickerClose}
            >
              {isReactionPickerOpen && !reacting && (
                <div
                  className="absolute bottom-full left-0 mb-2 bg-[var(--ant-color-bg-elevated)] rounded-full shadow-lg border border-[var(--ant-color-border-secondary)] p-1 flex items-center gap-1 z-50"
                  role="menu"
                  aria-label={ta('choose_reaction_aria')}
                >
                  {reactionOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`flex items-center justify-center w-9 h-9 rounded-full transition-transform hover:scale-110 active:scale-95 ${
                        currentReaction === option.key ? 'ring-2 ring-[var(--ant-color-border)] scale-110' : ''
                      }`}
                      aria-label={option.label}
                      title={option.label}
                      style={{
                        color: REACTION_PALETTE[option.key].color,
                        backgroundColor:
                          currentReaction === option.key ? REACTION_PALETTE[option.key].softBg : 'transparent',
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleReactionSelect(option.key);
                      }}
                    >
                      <span className="text-base">{option.icon}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm font-medium text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)] transition-colors disabled:opacity-60"
                style={currentReaction ? { color: REACTION_PALETTE[currentReaction].color } : undefined}
                disabled={reacting}
                aria-label={selectedReaction?.label || ta('like')}
                onClick={(event) => {
                  event.stopPropagation();
                  handleReactionSelect(currentReaction || 'like');
                }}
                onPointerDown={handleReactionPointerDown}
                onPointerUp={clearLongPressTimer}
                onPointerCancel={clearLongPressTimer}
                onPointerLeave={clearLongPressTimer}
              >
                {selectedReaction?.icon || <HeartOutlined className="text-base" />}
                <span>{item.metrics.reactions}</span>
              </button>
            </div>

            <button
              type="button"
              className="flex items-center gap-1.5 text-sm font-medium text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)] transition-colors"
              onMouseEnter={handlePrefetch}
              onClick={(event) => {
                event.stopPropagation();
                handleOpen();
              }}
            >
              <MessageOutlined className="text-base" />
              <span>{item.metrics.comments}</span>
            </button>

            <Popover
              trigger="click"
              placement="top"
              overlayClassName="p-0 shadow-xl rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-elevated)]"
              open={isSharePopoverOpen}
              onOpenChange={(open) => {
                setIsSharePopoverOpen(open);
                if (!open) setIsLinkCopied(false);
              }}
              content={shareMenuContent}
            >
              <button
                type="button"
                className="flex items-center text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)] transition-colors"
                aria-label={ta('share')}
                onClick={stopPropagation}
              >
                <ShareAltOutlined className="text-base" />
              </button>
            </Popover>
          </div>

          <button
            type="button"
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-60 ${
              isBookmarked
                ? 'bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)]'
                : 'bg-[var(--ant-color-fill-tertiary)] text-[var(--ant-color-text-secondary)] hover:bg-[var(--ant-color-primary-bg)] hover:text-[var(--ant-color-primary)]'
            }`}
            disabled={saving}
            onClick={(event) => {
              event.stopPropagation();
              void onSave?.(item.id);
            }}
          >
            <BookOutlined className="text-sm" />
            <span>{isBookmarked ? ta('saved') : ta('save')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedGridCard;
