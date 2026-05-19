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
  hideInteractions?: boolean;
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
  hideInteractions = false,
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
  const detailPath = `/feed/${item.id}`;
  const isPostOwner = !!user && item.author?.id === user.id;
  const canFollow = !!onToggleFollow && !!user && !!item.author?.id && !isPostOwner;
  const isFollowingAuthor = Boolean(item.userInteraction?.isFollowingAuthor);
  const canViewDashboard =
    item.assetType === 'dashboard' && !!item.assetId && (item.visibility !== 'private' || isPostOwner);
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
  const handlePreviewOpen = () => {
    if (!canViewDashboard) return;
    router.push('/dashboards');
  };
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
    <Card
      className={`bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border-secondary)] shadow-sm rounded-xl overflow-hidden mb-6 hover:shadow-md transition-shadow`}
      bodyStyle={{ padding: 0 }}
    >
      <FeedCardHeader
        item={item}
        visibilityLabel={visibilityLabel}
        canFollow={canFollow}
        isFollowingAuthor={isFollowingAuthor}
        followPending={following}
        deletePending={deleting}
        onToggleFollow={canFollow ? handleToggleFollow : undefined}
        onOpenPost={handleOpen}
        onCopyLink={handleCopyLink}
        onDeletePost={isPostOwner ? handleDeleteItem : undefined}
      />

      <FeedCardBody
        item={item}
        compact={compact}
        previewClickable={canViewDashboard}
        onPreviewClick={handlePreviewOpen}
      />

      {!hideInteractions && (
        <>
          <FeedCardActions
            ref={actionsRef}
            item={item}
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
  );
};

export default FeedCard;
