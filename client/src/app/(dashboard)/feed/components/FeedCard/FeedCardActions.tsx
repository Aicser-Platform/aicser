'use client';

import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Button, Popover, message } from 'antd';
import {
  BookOutlined,
  CheckCircleFilled,
  EyeOutlined,
  LikeOutlined,
  LinkOutlined,
  MessageOutlined,
  ReadOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { socialFeedService } from '@/services/socialFeedService';
import type { FeedItem, ReactionType } from '@/services/socialFeedService';
import { reactionOptions } from './constants';
import { useTranslations } from 'next-intl';

export interface FeedCardActionsHandle {
  closeReactionPicker: () => void;
}

interface FeedCardActionsProps {
  item: FeedItem;
  reacting: boolean;
  saving: boolean;
  commenting: boolean;
  detailPath: string;
  stopPropagation: (event: React.MouseEvent<HTMLElement>) => void;
  onReact: (itemId: string, reaction: ReactionType) => Promise<void> | void;
  onSave: (itemId: string) => Promise<void> | void;
  onOpen: () => void;
  onPrefetch: () => void;
  showCommentBox: boolean;
  onToggleCommentBox: () => void;
  closeCommentReactionPicker: () => void;
}

const FeedCardActions = React.forwardRef<FeedCardActionsHandle, FeedCardActionsProps>(
  (
    {
      item,
      reacting,
      saving,
      commenting,
      detailPath,
      stopPropagation,
      onReact,
      onSave,
      onOpen,
      onPrefetch,
      showCommentBox,
      onToggleCommentBox,
      closeCommentReactionPicker,
    },
    ref
  ) => {
    const t = useTranslations('feed_card_actions');
    const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false);
    const [isSharePopoverOpen, setIsSharePopoverOpen] = useState(false);
    const [isLinkCopied, setIsLinkCopied] = useState(false);

    const closePickerTimerRef = useRef<number | null>(null);
    const longPressTimerRef = useRef<number | null>(null);
    const shareCopyTimerRef = useRef<number | null>(null);
    const reactionPickerRef = useRef<HTMLDivElement | null>(null);

    const currentReaction = item.userInteraction.reaction;
    const selectedReaction = useMemo(
      () => (currentReaction ? reactionOptions.find((option) => option.key === currentReaction) : null),
      [currentReaction]
    );
    const reactionLabel = selectedReaction?.label || t('like');

    const reactionPalette: Record<
      ReactionType,
      { color: string; softBg: string; bubbleBg: string; bubbleText: string }
    > = {
      like: { color: '#1877F2', softBg: 'rgba(24, 119, 242, 0.12)', bubbleBg: '#1877F2', bubbleText: '#ffffff' },
      applause: { color: '#2E8B57', softBg: 'rgba(46, 139, 87, 0.14)', bubbleBg: '#2E8B57', bubbleText: '#ffffff' },
      celebrate: { color: '#6F58B0', softBg: 'rgba(111, 88, 176, 0.14)', bubbleBg: '#6F58B0', bubbleText: '#ffffff' },
      love: { color: '#D9643A', softBg: 'rgba(217, 100, 58, 0.14)', bubbleBg: '#D9643A', bubbleText: '#ffffff' },
      insightful: { color: '#D9A321', softBg: 'rgba(217, 163, 33, 0.16)', bubbleBg: '#D9A321', bubbleText: '#1f2937' },
      funny: { color: '#18AFC6', softBg: 'rgba(24, 175, 198, 0.14)', bubbleBg: '#18AFC6', bubbleText: '#ffffff' },
    };

    const reactionClass = currentReaction
      ? '!font-semibold'
      : '!text-[var(--ant-color-text-secondary)] hover:!text-[var(--ant-color-text)] hover:!bg-[var(--ant-color-bg-layout)]';

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

    const clearShareCopyTimer = useCallback(() => {
      if (shareCopyTimerRef.current !== null) {
        window.clearTimeout(shareCopyTimerRef.current);
        shareCopyTimerRef.current = null;
      }
    }, []);

    const closeReactionPicker = useCallback(() => {
      clearReactionCloseTimer();
      setIsReactionPickerOpen(false);
    }, [clearReactionCloseTimer]);

    useImperativeHandle(
      ref,
      () => ({
        closeReactionPicker,
      }),
      [closeReactionPicker]
    );

    const openReactionPicker = () => {
      clearReactionCloseTimer();
      closeCommentReactionPicker();
      setIsReactionPickerOpen(true);
    };

    const scheduleReactionPickerClose = () => {
      clearReactionCloseTimer();
      closePickerTimerRef.current = window.setTimeout(() => {
        setIsReactionPickerOpen(false);
      }, 140);
    };

    const handleReactionSelect = (reaction: ReactionType) => {
      onReact(item.id, reaction);
      closeReactionPicker();
    };

    const handleReactionPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== 'touch' || reacting) return;
      clearLongPressTimer();
      longPressTimerRef.current = window.setTimeout(() => {
        closeCommentReactionPicker();
        setIsReactionPickerOpen(true);
      }, 260);
    };

    const getShareUrl = useCallback(() => {
      if (typeof window === 'undefined') return detailPath;
      return new URL(detailPath, window.location.origin).toString();
    }, [detailPath]);

    const copyShareLink = useCallback(async () => {
      const url = getShareUrl();

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        return;
      }

      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (!success) {
        throw new Error(t('copy_failed'));
      }
    }, [getShareUrl]);

    const handleCopyShareLink = useCallback(
      async (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        try {
          await copyShareLink();
          void socialFeedService.shareItem(item.id);
          clearShareCopyTimer();
          setIsLinkCopied(true);
          shareCopyTimerRef.current = window.setTimeout(() => {
            setIsLinkCopied(false);
            shareCopyTimerRef.current = null;
          }, 1700);
        } catch (error) {
          message.error(error instanceof Error ? error.message : t('unable_copy_link'));
        }
      },
      [copyShareLink, clearShareCopyTimer, item.id]
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

    useEffect(() => {
      return () => {
        clearReactionCloseTimer();
        clearLongPressTimer();
        clearShareCopyTimer();
      };
    }, [clearReactionCloseTimer, clearLongPressTimer, clearShareCopyTimer]);

    useEffect(() => {
      if (!isReactionPickerOpen) return;

      const handleOutsidePointerDown = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (!reactionPickerRef.current?.contains(target)) {
          closeReactionPicker();
        }
      };

      document.addEventListener('pointerdown', handleOutsidePointerDown, true);
      return () => {
        document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      };
    }, [isReactionPickerOpen, closeReactionPicker]);

    useEffect(() => {
      closeReactionPicker();
      clearLongPressTimer();
      clearShareCopyTimer();
      setIsSharePopoverOpen(false);
      setIsLinkCopied(false);
    }, [item.id, closeReactionPicker, clearLongPressTimer, clearShareCopyTimer]);

    const hasMetrics = item.metrics.reactions > 0 || item.metrics.comments > 0 || item.metrics.views > 0;

    // Build the stacked reaction icon list:
    // - If the user has reacted, show only their reaction type
    // - Otherwise fall back to 'like' as the default display icon
    const reactionIconKeys: ReactionType[] = useMemo(() => {
      return currentReaction ? [currentReaction] : ['like'];
    }, [currentReaction]);

    const reactionIconMap = useMemo(() => Object.fromEntries(reactionOptions.map((o) => [o.key, o])), []);

    return (
      <div className="flex flex-col border-t border-[var(--ant-color-border-secondary)]" onClick={stopPropagation}>
        {/* LinkedIn-style social metrics summary */}
        {hasMetrics && (
          <div className="flex px-5 py-2.5 items-center justify-between text-xs text-[var(--ant-color-text-secondary)] border-b border-[var(--ant-color-bg-layout)]">
            {item.metrics.reactions > 0 && (
              <span className="flex items-center gap-1.5 font-medium cursor-pointer hover:text-[var(--ant-color-primary)] transition-colors">
                <span className="flex items-center -space-x-1">
                  {reactionIconKeys.map((key, idx) => {
                    const opt = reactionIconMap[key];
                    return (
                      <span
                        key={key}
                        className="flex items-center justify-center w-[18px] h-[18px] rounded-full ring-2 ring-[var(--ant-color-bg-container)] text-[10px] shadow-sm"
                        style={{
                          backgroundColor: reactionPalette[key].bubbleBg,
                          color: reactionPalette[key].bubbleText,
                          zIndex: reactionIconKeys.length - idx,
                        }}
                        title={opt?.label}
                      >
                        {opt?.icon}
                      </span>
                    );
                  })}
                </span>
                <span>{item.metrics.reactions}</span>
              </span>
            )}

            <div className="flex items-center gap-3 ml-auto opacity-80">
              {item.metrics.comments > 0 && (
                <span className="hover:text-[var(--ant-color-primary)] cursor-pointer transition-colors">
                  {item.metrics.comments} comment{item.metrics.comments !== 1 ? 's' : ''}
                </span>
              )}
              {item.metrics.views > 0 && (
                <span className="flex items-center gap-1">
                  <EyeOutlined />
                  {item.metrics.views} view{item.metrics.views !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        )}

        {/* LinkedIn-style action bar */}
        <div className="flex px-2 py-1 items-center justify-between gap-1 flex-wrap">
          <div
            ref={reactionPickerRef}
            className="relative flex-1"
            onMouseEnter={openReactionPicker}
            onMouseLeave={scheduleReactionPickerClose}
            onClick={stopPropagation}
          >
            {isReactionPickerOpen && !reacting && (
              <div
                className="absolute bottom-full left-0 mb-2 bg-[var(--ant-color-bg-elevated)] rounded-full shadow-lg border border-[var(--ant-color-border-secondary)] p-1 flex items-center gap-1 z-50 animate-in fade-in slide-in-from-bottom-2"
                role="menu"
                aria-label={t('choose_reaction_aria')}
              >
                {reactionOptions.map((option) => {
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`flex items-center justify-center w-10 h-10 rounded-full transition-transform hover:scale-110 active:scale-95 ${
                        currentReaction === option.key ? 'ring-2 ring-[var(--ant-color-border)] scale-110' : ''
                      }`}
                      aria-label={option.label}
                      title={option.label}
                      style={{
                        color: reactionPalette[option.key].color,
                        backgroundColor:
                          currentReaction === option.key ? reactionPalette[option.key].softBg : 'transparent',
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleReactionSelect(option.key);
                      }}
                    >
                      <span className="text-xl">{option.icon}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <Button
              type="text"
              className={`w-full flex items-center justify-center gap-2 h-10 rounded-md font-medium transition-colors ${reactionClass}`}
              style={
                currentReaction
                  ? {
                      color: reactionPalette[currentReaction].color,
                      backgroundColor: reactionPalette[currentReaction].softBg,
                    }
                  : undefined
              }
              icon={selectedReaction?.icon || <LikeOutlined className="text-lg" />}
              loading={reacting}
              disabled={reacting}
              onClick={(event) => {
                event.stopPropagation();
                closeCommentReactionPicker();
                setIsReactionPickerOpen((previous) => !previous);
              }}
              onPointerDown={handleReactionPointerDown}
              onPointerUp={clearLongPressTimer}
              onPointerCancel={clearLongPressTimer}
              onPointerLeave={clearLongPressTimer}
            >
              <span className="hidden sm:inline">{reactionLabel}</span>
            </Button>
          </div>

          <Button
            type="text"
            className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-md font-medium text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)] transition-colors ${showCommentBox ? 'bg-[var(--ant-color-bg-layout)] text-[var(--ant-color-text)]' : ''}`}
            icon={<MessageOutlined className="text-lg" />}
            loading={commenting}
            disabled={commenting}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCommentBox();
            }}
          >
            <span className="hidden sm:inline">{t('comment')}</span>
          </Button>

          <Button
            type="text"
            className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-md font-medium text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)] transition-colors ${item.userInteraction.isBookmarked ? 'text-[var(--ant-color-primary)] bg-[var(--ant-color-primary-bg)]' : ''}`}
            icon={<BookOutlined className="text-lg" />}
            loading={saving}
            disabled={saving}
            onClick={(event) => {
              event.stopPropagation();
              onSave(item.id);
            }}
          >
            <span className="hidden sm:inline">{item.userInteraction.isBookmarked ? t('saved') : t('save')}</span>
          </Button>

          <Button
            type="text"
            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-md font-medium text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)] transition-colors"
            icon={<ReadOutlined className="text-lg" />}
            onMouseEnter={onPrefetch}
            onFocus={onPrefetch}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            <span className="hidden sm:inline">{t('open')}</span>
          </Button>

          <Popover
            trigger="click"
            placement="top"
            overlayClassName="p-0 shadow-xl rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-elevated)]"
            open={isSharePopoverOpen}
            onOpenChange={(open) => {
              setIsSharePopoverOpen(open);
              if (!open) {
                clearShareCopyTimer();
                setIsLinkCopied(false);
              }
            }}
            content={
              <div
                className="flex flex-col min-w-[200px] text-sm overflow-hidden rounded-xl bg-[var(--ant-color-bg-elevated)]"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className={`flex items-center gap-2.5 px-4 py-3 text-left font-medium transition-colors ${isLinkCopied ? 'bg-[var(--ant-color-success-bg)] text-[var(--ant-color-success)]' : 'text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)]'}`}
                  onClick={handleCopyShareLink}
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
                  {t('share_to_linkedin')}
                </button>
                <button
                  type="button"
                  className="px-4 py-3 text-left font-medium text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)] transition-colors"
                  onClick={handleShareToX}
                >
                  {t('share_to_x')}
                </button>
              </div>
            }
          >
            <Button
              type="text"
              className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-md font-medium text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)] transition-colors ${isSharePopoverOpen ? 'bg-[var(--ant-color-bg-layout)] text-[var(--ant-color-text)]' : ''}`}
              icon={<ShareAltOutlined className="text-lg" />}
              onClick={stopPropagation}
            >
              <span className="hidden sm:inline">{t('share')}</span>
            </Button>
          </Popover>
        </div>
      </div>
    );
  }
);

FeedCardActions.displayName = 'FeedCardActions';

export default FeedCardActions;
