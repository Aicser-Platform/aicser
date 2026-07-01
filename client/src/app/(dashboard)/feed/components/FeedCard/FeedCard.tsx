'use client';

import React, { useCallback, useRef } from 'react';
import { Card, message } from 'antd';
import { useRouter } from 'next/navigation';
import { socialFeedService } from '@/services/socialFeedService';
import type { FeedItem, ReactionType } from '@/services/socialFeedService';
import FeedCardActions, { FeedCardActionsHandle } from './FeedCardActions';
import FeedCardBody from './FeedCardBody';
import FeedCardComments from './FeedCardComments';
import FeedCardHeader from './FeedCardHeader';
import useFeedCardComments from './useFeedCardComments';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useTranslations } from 'next-intl';

interface FeedCardProps {
  item: FeedItem;
  onReact?: (itemId: string, reaction: ReactionType) => Promise<void> | void;
  onSave?: (itemId: string) => Promise<void> | void;
  onAddComment?: (itemId: string, content: string, parentCommentId?: string) => Promise<void> | void;
  onToggleFollow?: (itemId: string, authorId: string) => Promise<void> | void;
  onDeleteItem?: (itemId: string) => Promise<void> | void;
  onCommentDeleted?: (itemId: string, commentCount: number) => void;
  interactionState?: {
    reacting?: boolean;
    saving?: boolean;
    commenting?: boolean;
    following?: boolean;
    deleting?: boolean;
  };
  compact?: boolean;
  hidePreview?: boolean;
  hideInteractions?: boolean;
  highlighted?: boolean;
  /** Detail link base — default `/feed` for app feed; `/discover` for public. */
  detailBasePath?: string;
}

const FeedCard: React.FC<FeedCardProps> = ({
  item,
  onReact,
  onSave,
  onAddComment,
  onToggleFollow,
  onDeleteItem,
  onCommentDeleted,
  interactionState,
  compact = false,
  hidePreview = false,
  hideInteractions = false,
  highlighted = false,
  detailBasePath = '/feed',
}) => {
  const t = useTranslations('feed');
  const router = useRouter();
  const actionsRef = useRef<FeedCardActionsHandle | null>(null);
  const { user } = useAuth();

  const reacting = Boolean(interactionState?.reacting);
  const saving = Boolean(interactionState?.saving);
  const commenting = Boolean(interactionState?.commenting);
  const following = Boolean(interactionState?.following);
  const deleting = Boolean(interactionState?.deleting);
  const detailPath = `${detailBasePath}/${item.id}`;
  // Compare by username too: author.id can come from a different identity source
  // than the session user.id for legacy/seeded posts, which otherwise leaks a
  // "Follow" button onto the viewer's own posts.
  const normalizeHandle = (handle?: string) => handle?.trim().replace(/^@/, '').toLowerCase() || '';
  const isPostOwner =
    !!user &&
    (item.author?.id === user.id ||
      (!!user.username && normalizeHandle(item.author?.username) === normalizeHandle(user.username)));
  const canFollow = !!onToggleFollow && !!user && !!item.author?.id && !isPostOwner;
  const isFollowingAuthor = Boolean(item.userInteraction?.isFollowingAuthor);
  const safeAddComment = useCallback(
    (itemId: string, content: string, parentCommentId?: string) => {
      if (!onAddComment) return;
      return onAddComment(itemId, content, parentCommentId);
    },
    [onAddComment]
  );
  const commentApi = useFeedCardComments({ item, compact, onAddComment: safeAddComment, onCommentDeleted, commenting });
  const handleReact = useCallback(
    (itemId: string, reaction: ReactionType) => {
      if (!onReact) return;
      return onReact(itemId, reaction);
    },
    [onReact]
  );
  const handleSave = useCallback(
    (itemId: string) => {
      if (!onSave) return;
      return onSave(itemId);
    },
    [onSave]
  );

  const handleOpen = () => router.push(detailPath);
  const handlePrefetch = () => router.prefetch(detailPath);
  const handleToggleFollow = useCallback(() => {
    if (!item.author?.id || !onToggleFollow) return;
    onToggleFollow(item.id, item.author.id);
  }, [item.author?.id, item.id, onToggleFollow]);
  const handleDeleteItem = useCallback(() => {
    if (!onDeleteItem) return;
    onDeleteItem(item.id);
  }, [item.id, onDeleteItem]);
  const handleCopyLink = useCallback(async () => {
    const url = typeof window !== 'undefined' ? new URL(detailPath, window.location.origin).toString() : detailPath;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard not available');
      }
      await navigator.clipboard.writeText(url);
      void socialFeedService.shareItem(item.id);
      message.success(t('link_copied'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('unable_copy_link'));
    }
  }, [detailPath, item.id, t]);

  const stopPropagation = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const visibilityLabel = (() => {
    switch (item.visibility) {
      case 'organization':
        return t('scope_organization');
      case 'project':
        return t('scope_project');
      case 'private':
        return t('scope_private');
      case 'following':
        return t('scope_following');
      case 'public':
        return t('scope_public');
      default: {
        const v: string = item.visibility;
        return v.charAt(0).toUpperCase() + v.slice(1);
      }
    }
  })();

  const hasCommentListToggle = item.metrics.comments > 0 || commentApi.commentTree.length > 0;

  const handleOpenCommentReactionPicker = useCallback(
    (commentId: string) => {
      actionsRef.current?.closeReactionPicker();
      commentApi.openCommentReactionPicker(commentId);
    },
    [commentApi]
  );

  return (
    <div id={`feed-post-${item.id}`}>
    <Card
      className={`bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border-secondary)] shadow-sm rounded-xl overflow-hidden hover:shadow-md transition-all duration-300 ${
        compact ? '' : 'mb-4'
      } ${highlighted ? 'ring-2 ring-[var(--ant-color-primary)] bg-[var(--ant-color-primary-bg)]' : ''}`}
      bodyStyle={{ padding: 0 }}
    >
      <FeedCardHeader
        item={item}
        compact={compact}
        visibilityLabel={visibilityLabel}
        canFollow={canFollow}
        isFollowingAuthor={isFollowingAuthor}
        followPending={following}
        deletePending={deleting}
        onToggleFollow={canFollow ? handleToggleFollow : undefined}
        onOpenPost={handleOpen}
        onCopyLink={handleCopyLink}
        onDeletePost={isPostOwner ? handleDeleteItem : undefined}
        authorProfileBasePath={detailBasePath === '/discover' ? '/discover/author' : undefined}
      />

      <FeedCardBody
        item={item}
        compact={compact}
        hidePreview={hidePreview}
        previewClickable
        onPreviewClick={handleOpen}
      />

      {!hideInteractions && (
        <>
          <FeedCardActions
            ref={actionsRef}
            item={item}
            compact={compact}
            reacting={reacting}
            saving={saving}
            commenting={commenting}
            detailPath={detailPath}
            stopPropagation={stopPropagation}
            onReact={handleReact}
            onSave={handleSave}
            onOpen={handleOpen}
            onPrefetch={handlePrefetch}
            showCommentBox={commentApi.showCommentBox}
            onToggleCommentBox={commentApi.toggleCommentBox}
            closeCommentReactionPicker={commentApi.closeCommentReactionPicker}
          />

          <FeedCardComments
            item={item}
            compact={compact}
            commentValue={commentApi.commentValue}
            showCommentBox={commentApi.showCommentBox}
            showCommentsList={commentApi.showCommentsList}
            commentTree={commentApi.commentTree}
            loadingComments={commentApi.loadingComments}
            expandedComments={commentApi.expandedComments}
            hasMoreComments={commentApi.hasMoreComments}
            hasCommentListToggle={hasCommentListToggle}
            replyToCommentId={commentApi.replyToCommentId}
            replyValue={commentApi.replyValue}
            editingCommentId={commentApi.editingCommentId}
            editValue={commentApi.editValue}
            openCommentReactionId={commentApi.openCommentReactionId}
            animatingCommentReactionId={commentApi.animatingCommentReactionId}
            expandedReplyGroups={commentApi.expandedReplyGroups}
            pendingReply={commentApi.pendingReply}
            pendingEdit={commentApi.pendingEdit}
            pendingCommentReactionId={commentApi.pendingCommentReactionId}
            pendingDeleteCommentId={commentApi.pendingDeleteCommentId}
            onCommentValueChange={commentApi.setCommentValue}
            onToggleCommentsList={commentApi.handleToggleCommentsList}
            onToggleAllComments={commentApi.handleToggleAllComments}
            onCommentSubmit={commentApi.handleCommentSubmit}
            onStartEdit={commentApi.handleStartEdit}
            onSaveEdit={commentApi.handleSaveEdit}
            onReplySubmit={commentApi.handleReplySubmit}
            onToggleReply={commentApi.toggleReplyForComment}
            onReplyValueChange={commentApi.setReplyValue}
            onEditValueChange={commentApi.setEditValue}
            onToggleReplyGroup={commentApi.toggleReplyGroup}
            onCancelEdit={commentApi.cancelEdit}
            onCancelReply={commentApi.cancelReply}
            onCloseCommentBox={commentApi.closeCommentBox}
            onDeleteComment={commentApi.handleDeleteComment}
            onCommentReactionSelect={commentApi.handleCommentReactionSelect}
            onOpenCommentReactionPicker={handleOpenCommentReactionPicker}
            onScheduleCommentReactionPickerClose={commentApi.scheduleCommentReactionPickerClose}
            onToggleCommentReactionPicker={commentApi.toggleCommentReactionPicker}
            stopPropagation={stopPropagation}
          />
        </>
      )}
    </Card>
    </div>
  );
};

export default FeedCard;
