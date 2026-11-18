'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Check,
  Ellipsis,
  ExternalLink,
  Link2,
  MessageCircle,
  Share2,
  ThumbsUp,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/aicser-ui/badge';
import { Button } from '@/components/aicser-ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/aicser-ui/dropdown-menu';
import { BookmarkIcon } from '@/components/icons/BookmarkIcon';
import { FeedAuthorAvatar } from '@/components/Feed/FeedAuthorAvatar';
import { FeedImages } from '@/components/Feed/FeedImages';
import { FeedPostContent } from '@/components/Feed/FeedPostContent';
import {
  buildPreviewFeedItem,
  isFeedPostAuthor,
  resolveFeedCardHeading,
  resolveFeedPostSummary,
} from '@/components/Feed/feedPostDisplay';
import { useFeedAuthorDisplay } from '@/components/Feed/useFeedAuthorDisplay';
import { errorMessage } from '@/hooks/feed/feedInteractionUtils';
import { cn } from '@/lib/ui/utils';
import { message } from '@/lib/ui/toast';
import { formatTimeAgo, socialFeedService } from '@/services/socialFeedService';
import type { FeedItem, ReactionType } from '@/services/socialFeedService';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import FeedCardMedia from './FeedCardMedia';
import { reactionOptions } from './FeedCard/constants';
import ReactionBreakdownTooltip from './FeedCard/ReactionBreakdownTooltip';

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
  /** Maximum visual previews teased on the card. Defaults to 1 for tight grids, 3+ for single-column feed. */
  maxPreviews?: number;
}

/** Reaction colours (brand colours of each reaction, as before). */
const REACTION_COLOR: Record<ReactionType, string> = {
  like: '#1877F2',
  applause: '#2E8B57',
  celebrate: '#6F58B0',
  love: '#D9643A',
  insightful: '#D9A321',
  funny: '#18AFC6',
};

const footerButton =
  'inline-flex h-8 items-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 [&_svg]:size-4';

/**
 * One post in the feed grid (Aicser UI, the desktop's FeedCard): author and time with one menu, the post, its
 * preview, then reactions · comments · share and Save. Comments live on the post page.
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
  maxPreviews = 1,
}) => {
  const t = useTranslations('feed');
  const ta = useTranslations('feed_card_actions');
  const router = useRouter();
  const { user } = useAuth();
  const { name: authorName } = useFeedAuthorDisplay(item.author);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const closePickerTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const reacting = Boolean(interactionState?.reacting);
  const saving = Boolean(interactionState?.saving);
  const deleting = Boolean(interactionState?.deleting);
  const followPending = Boolean(interactionState?.following);
  const detailPath = `${detailBasePath}/${item.id}`;

  const isPostOwner = isFeedPostAuthor(item, user);
  const canFollow = !!onToggleFollow && !!user && !!item.author?.id && !isPostOwner;
  const isFollowingAuthor = Boolean(item.userInteraction?.isFollowingAuthor);
  const currentReaction = item.userInteraction.reaction;
  const selectedReaction = currentReaction ? reactionOptions.find((o) => o.key === currentReaction) : null;
  const isBookmarked = item.userInteraction.isBookmarked;
  const authorTitle = item.author.title?.trim();
  const description = useMemo(() => resolveFeedPostSummary(item), [item]);

  // A text post has no asset of its own: its first viewable attachment stands in as the preview (as on the post
  // page), with "+N" for the rest.
  const visibleAttachments = useMemo(
    () => item.attachments?.filter((a) => !a.restricted && a.referencedPostId) ?? [],
    [item.attachments]
  );
  const primaryAttachment = visibleAttachments[0];
  const extraAttachmentCount = Math.max(0, visibleAttachments.length - 1);
  const attachmentPreviewItem = useMemo(() => {
    if (item.assetType !== 'post' || !primaryAttachment) return null;
    return buildPreviewFeedItem({
      assetType: primaryAttachment.asset_type,
      assetId: primaryAttachment.asset_id,
      title: primaryAttachment.title || item.title,
      renderMode: primaryAttachment.renderMode,
      snapshotPayload: primaryAttachment.snapshotPayload ?? undefined,
      previewMetadata: {
        previewType: primaryAttachment.previewType,
        previewData: primaryAttachment.previewData,
        previews: primaryAttachment.previews,
        chartWidget: primaryAttachment.chartWidget,
        dashboardId: primaryAttachment.dashboardId,
      },
    });
  }, [item.assetType, item.title, primaryAttachment]);
  const mediaItem = attachmentPreviewItem ?? item;
  const heading = useMemo(() => resolveFeedCardHeading(item, mediaItem), [item, mediaItem]);

  const open = useCallback(() => router.push(detailPath), [router, detailPath]);
  const prefetch = useCallback(() => router.prefetch(detailPath), [router, detailPath]);
  const toggleFollow = useCallback(() => {
    if (item.author?.id && onToggleFollow) void onToggleFollow(item.id, item.author.id);
  }, [item.author?.id, item.id, onToggleFollow]);

  const shareUrl = useCallback(
    () => (typeof window === 'undefined' ? detailPath : new URL(detailPath, window.location.origin).toString()),
    [detailPath]
  );
  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
      void socialFeedService.shareItem(item.id);
      message.success(t('link_copied'));
    } catch (error) {
      message.error(errorMessage(error, t('unable_copy_link')));
    }
  }, [shareUrl, item.id, t]);
  const shareTo = useCallback(
    (network: 'linkedin' | 'x' | 'telegram' | 'whatsapp') => {
      const url = encodeURIComponent(shareUrl());
      const text = encodeURIComponent(item.title);
      const target = {
        linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
        x: `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
        telegram: `https://t.me/share/url?url=${url}&text=${text}`,
        whatsapp: `https://wa.me/?text=${encodeURIComponent(`${item.title}\n${shareUrl()}`)}`,
      }[network];
      window.open(target, '_blank', 'noopener,noreferrer');
      void socialFeedService.shareItem(item.id);
    },
    [shareUrl, item.id, item.title]
  );

  // Reaction picker: opens on hover (or a long press on touch), the button itself toggles the current reaction.
  const clearClose = useCallback(() => {
    if (closePickerTimer.current !== null) window.clearTimeout(closePickerTimer.current);
    closePickerTimer.current = null;
  }, []);
  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }, []);
  const react = useCallback(
    (reaction: ReactionType) => {
      void onReact?.(item.id, reaction);
      clearClose();
      setPickerOpen(false);
    },
    [clearClose, item.id, onReact]
  );
  useEffect(
    () => () => {
      clearClose();
      clearLongPress();
    },
    [clearClose, clearLongPress]
  );
  useEffect(() => {
    if (!pickerOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setPickerOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [pickerOpen]);

  // An author's name and photo open their public profile (also for your own posts, as on other social apps).
  const authorProfileHref = item.author.username
    ? `/discover/author/${encodeURIComponent(item.author.username.replace(/^@/, ''))}`
    : null;
  const avatar = <FeedAuthorAvatar author={item.author} size={32} />;

  return (
    <div id={`feed-post-${item.id}`} className="w-full">
      <article
        className={cn(
          'flex w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground transition-shadow hover:shadow-sm',
          highlighted && 'ring-2 ring-primary'
        )}
      >
        <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {authorProfileHref ? (
              <Link href={authorProfileHref} className="shrink-0 rounded-full">
                {avatar}
              </Link>
            ) : (
              avatar
            )}
            <div className="flex min-w-0 flex-col">
              <div className="flex min-w-0 items-center gap-1.5">
                {authorProfileHref ? (
                  <Link
                    href={authorProfileHref}
                    className="truncate text-sm font-semibold text-foreground no-underline hover:underline"
                  >
                    {authorName}
                  </Link>
                ) : (
                  <span className="truncate text-sm font-semibold">{authorName}</span>
                )}
                {isPostOwner ? (
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                    {t('author_badge')}
                  </Badge>
                ) : null}
              </div>
              <span className="truncate text-xs text-muted-foreground">
                {authorTitle ? `${authorTitle} · ` : ''}
                {formatTimeAgo(item.lastActivityAt || item.publishedAt)}
              </span>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('more_actions')} disabled={deleting}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={open} onMouseEnter={prefetch}>
                <ExternalLink /> {t('open_post')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void copyLink()}>
                <Link2 /> {t('copy_link')}
              </DropdownMenuItem>
              {canFollow ? (
                <DropdownMenuItem disabled={followPending} onSelect={toggleFollow}>
                  {isFollowingAuthor ? <UserCheck /> : <UserPlus />}
                  {isFollowingAuthor ? t('unfollow_author') : t('follow_author')}
                </DropdownMenuItem>
              ) : null}
              {isPostOwner && onDeleteItem ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                    <Trash2 /> {t('delete_post')}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div className="px-4 pb-2">
          <FeedPostContent
            item={item}
            titleOverride={heading || undefined}
            descriptionOverride={description || undefined}
            descriptionMaxRows={3}
            variant="card"
          />
        </div>

        <FeedImages images={item.images} compact />

        <div className={cn('min-w-0 flex-1 px-4 pb-3', maxPreviews <= 1 && 'min-h-[220px]')}>
          <FeedCardMedia
            item={mediaItem}
            maxPreviews={maxPreviews}
            fillHeight={maxPreviews <= 1}
            previewClickable
            onPreviewClick={open}
            thumbnailWrapperClassName={maxPreviews <= 1 ? 'h-full' : undefined}
            tagsWrapperClassName="px-0 pt-2 pb-0"
            cornerBadge={
              extraAttachmentCount > 0 ? (
                <span className="rounded-full bg-popover px-2 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-sm ring-1 ring-foreground/10">
                  +{extraAttachmentCount}
                </span>
              ) : undefined
            }
          />
        </div>

        <footer className="flex items-center gap-1 border-t px-2 py-1.5">
          <div
            ref={pickerRef}
            className="relative"
            onMouseEnter={() => {
              clearClose();
              setPickerOpen(true);
            }}
            onMouseLeave={() => {
              clearClose();
              closePickerTimer.current = window.setTimeout(() => setPickerOpen(false), 140);
            }}
          >
            {pickerOpen && !reacting ? (
              <div
                role="menu"
                aria-label={ta('choose_reaction_aria')}
                className="absolute bottom-full left-0 z-50 mb-1 flex items-center gap-0.5 rounded-full bg-popover p-1 shadow-md ring-1 ring-foreground/10"
              >
                {reactionOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    role="menuitem"
                    aria-label={option.label}
                    title={option.label}
                    onClick={() => react(option.key)}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full border-0 bg-transparent transition-transform hover:scale-110 hover:bg-accent',
                      currentReaction === option.key && 'bg-accent'
                    )}
                    style={{ color: REACTION_COLOR[option.key] }}
                  >
                    {option.icon}
                  </button>
                ))}
              </div>
            ) : null}
            <ReactionBreakdownTooltip breakdown={item.metrics.reactionBreakdown}>
              <button
                type="button"
                className={footerButton}
                style={currentReaction ? { color: REACTION_COLOR[currentReaction] } : undefined}
                disabled={reacting}
                aria-label={selectedReaction?.label || ta('like')}
                aria-pressed={Boolean(currentReaction)}
                onClick={() => react(currentReaction || 'like')}
                onPointerDown={(event) => {
                  if (event.pointerType !== 'touch' || reacting) return;
                  clearLongPress();
                  longPressTimer.current = window.setTimeout(() => setPickerOpen(true), 260);
                }}
                onPointerUp={clearLongPress}
                onPointerCancel={clearLongPress}
                onPointerLeave={clearLongPress}
              >
                {selectedReaction?.icon || <ThumbsUp />}
                <span>{item.metrics.reactions}</span>
              </button>
            </ReactionBreakdownTooltip>
          </div>

          <button
            type="button"
            className={footerButton}
            onMouseEnter={prefetch}
            onClick={open}
            aria-label={t('open_post')}
          >
            <MessageCircle />
            <span>{item.metrics.comments}</span>
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={footerButton} aria-label={ta('share')}>
                <Share2 />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onSelect={() => void copyLink()}>
                <Link2 /> {t('copy_link')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => shareTo('linkedin')}>{ta('share_to_linkedin')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => shareTo('x')}>{ta('share_to_x')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => shareTo('telegram')}>{ta('share_to_telegram')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => shareTo('whatsapp')}>{ta('share_to_whatsapp')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant={isBookmarked ? 'secondary' : 'ghost'}
            size="sm"
            className="ml-auto"
            disabled={saving}
            aria-pressed={isBookmarked}
            onClick={() => void onSave?.(item.id)}
          >
            {isBookmarked ? <Check /> : <BookmarkIcon filled={false} />}
            {isBookmarked ? ta('saved') : ta('save')}
          </Button>
        </footer>
      </article>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('delete_post_confirm_title')}</DialogTitle>
            <DialogDescription>{t('delete_post_confirm_content')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                setConfirmDelete(false);
                void onDeleteItem?.(item.id);
              }}
            >
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FeedGridCard;
