'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Card, message } from 'antd';
import { useRouter } from 'next/navigation';
import { socialFeedService } from '@/services/socialFeedService';
import type { FeedItem, ReactionType } from '@/services/socialFeedService';
import { errorMessage } from '@/hooks/feed/feedInteractionUtils';
import { useMentionableMembers, resolveMentionedUserIds } from '@/hooks/feed/useMentionableMembers';
import { useProjectStore } from '@/stores/useProjectStore';
import { isFeedPostAuthor } from '@/components/Feed/feedPostDisplay';
import FeedCardActions, { FeedCardActionsHandle } from './FeedCardActions';
import FeedCardBody from './FeedCardBody';
import FeedCardComments from './FeedCardComments';
import FeedCardHeader from './FeedCardHeader';
import FeedPostEditBox from './FeedPostEditBox';
import useFeedCardComments from './useFeedCardComments';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useTranslations } from 'next-intl';

interface FeedCardProps {
  item: FeedItem;
  onReact?: (itemId: string, reaction: ReactionType) => Promise<void> | void;
  onSave?: (itemId: string) => Promise<void> | void;
  onAddComment?: (itemId: string, content: string, parentCommentId?: string, mentionedUsers?: string[]) => Promise<void> | void;
  onToggleFollow?: (itemId: string, authorId: string) => Promise<void> | void;
  onDeleteItem?: (itemId: string) => Promise<void> | void;
  onUpdatePost?: (itemId: string, description: string, mentionedUsers?: string[]) => Promise<boolean> | boolean;
  onCommentDeleted?: (itemId: string, commentCount: number) => void;
  interactionState?: {
    reacting?: boolean;
    saving?: boolean;
    commenting?: boolean;
    following?: boolean;
    deleting?: boolean;
    updatingPost?: boolean;
  };
  compact?: boolean;
  hidePreview?: boolean;
  hideInteractions?: boolean;
  highlighted?: boolean;
  /** Detail link base — default `/feed` for app feed; `/discover` for public. */
  detailBasePath?: string;
}

// Header/Body/Actions/Comments composite with inline comment threads — used by
// saved/commented/discover views. The main feed list uses the leaner FeedGridCard instead.
const FeedCard: React.FC<FeedCardProps> = ({
  item,
  onReact,
  onSave,
  onAddComment,
  onToggleFollow,
  onDeleteItem,
  onUpdatePost,
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
  const updatingPost = Boolean(interactionState?.updatingPost);
  const detailPath = `${detailBasePath}/${item.id}`;

  const [isEditingPost, setIsEditingPost] = useState(false);
  const [editPostValue, setEditPostValue] = useState('');
  const currentProject = useProjectStore((s) => s.currentProject);
  const organizationId =
    currentProject?.organization_id || (currentProject as { organizationId?: string } | null)?.organizationId;
  // Org-scoped regardless of this post's own visibility, same reasoning as
  // useFeedCardComments: mentioning never bypasses the post's own access gate.
  const { members: mentionMembers, options: editMentionOptions } = useMentionableMembers(
    'organization',
    organizationId,
    user?.id
  );
  const isPostOwner = isFeedPostAuthor(item, user);
  const canFollow = !!onToggleFollow && !!user && !!item.author?.id && !isPostOwner;
  const isFollowingAuthor = Boolean(item.userInteraction?.isFollowingAuthor);
  const safeAddComment = useCallback(
    (itemId: string, content: string, parentCommentId?: string, mentionedUsers?: string[]) => {
      if (!onAddComment) return;
      return onAddComment(itemId, content, parentCommentId, mentionedUsers);
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
  const handleStartEditPost = useCallback(() => {
    setEditPostValue(item.description);
    setIsEditingPost(true);
  }, [item.description]);
  const handleCancelEditPost = useCallback(() => {
    setIsEditingPost(false);
  }, []);
  const handleSaveEditPost = useCallback(async () => {
    if (!onUpdatePost) return;
    const body = editPostValue.trim();
    if (!body) return;
    const mentionedUsers = resolveMentionedUserIds(body, mentionMembers);
    const success = await onUpdatePost(item.id, body, mentionedUsers);
    if (success) setIsEditingPost(false);
  }, [editPostValue, item.id, mentionMembers, onUpdatePost]);
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
      message.error(errorMessage(error, t('unable_copy_link')));
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
      styles={{ body: { padding: 0 } }}
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
        onEditPost={item.canEdit && onUpdatePost ? handleStartEditPost : undefined}
        // See FeedGridCard's matching comment: this used to only link the author
        // on /discover, leaving the name a dead label everywhere else this card
        // renders (including /feed itself) — /discover/author/[username] already
        // works for any author regardless of which page led here.
        authorProfileBasePath="/discover/author"
      />

      {isEditingPost ? (
        <FeedPostEditBox
          compact={compact}
          value={editPostValue}
          onChange={setEditPostValue}
          mentionOptions={editMentionOptions}
          saving={updatingPost}
          onSave={handleSaveEditPost}
          onCancel={handleCancelEditPost}
        />
      ) : (
        <FeedCardBody
          item={item}
          compact={compact}
          hidePreview={hidePreview}
          previewClickable
          onPreviewClick={handleOpen}
        />
      )}

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
            mentionOptions={commentApi.mentionOptions}
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
