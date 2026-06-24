'use client';

import React, { useCallback, useState } from 'react';
import { Typography } from 'antd';
import type { FeedItem, ReactionType } from '@/services/socialFeedService';
import useFeedCardComments from '../FeedCard/useFeedCardComments';
import FeedDiscussionComment from './FeedDiscussionComment';
import FeedDiscussionComposer from './FeedDiscussionComposer';

const { Title } = Typography;

interface FeedDiscussionProps {
  item: FeedItem;
  onAddComment?: (itemId: string, content: string, parentCommentId?: string) => Promise<void> | void;
  onCommentDeleted?: (itemId: string, commentCount: number) => void;
  commenting?: boolean;
}

/**
 * Slack/Notion-style discussion panel for the feed detail page.
 * Always-expanded — no click-to-reveal step for either the comment list or
 * the composer. Reuses `useFeedCardComments` unchanged for all comment
 * state/logic; only the "resolved" toggle below is local-only UI state that
 * is not persisted anywhere.
 */
const FeedDiscussion: React.FC<FeedDiscussionProps> = ({ item, onAddComment, onCommentDeleted, commenting = false }) => {
  const [resolvedCommentIds, setResolvedCommentIds] = useState<Set<string>>(new Set());

  const safeAddComment = useCallback(
    (itemId: string, content: string, parentCommentId?: string) => {
      if (!onAddComment) return;
      return onAddComment(itemId, content, parentCommentId);
    },
    [onAddComment]
  );

  const commentApi = useFeedCardComments({
    item,
    compact: false,
    onAddComment: safeAddComment,
    onCommentDeleted,
    commenting,
  });

  const toggleResolve = useCallback((commentId: string) => {
    setResolvedCommentIds((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  }, []);

  // Reaction click handler also closes any other open comment-card reaction
  // picker; FeedCard does this through FeedCardActionsHandle, but the
  // Discussion panel has no equivalent post-level reaction bar to coordinate
  // with, so the hook's picker handlers are used directly.
  const handleReactionSelect = (commentId: string, reaction: ReactionType) => {
    void commentApi.handleCommentReactionSelect(commentId, reaction);
  };

  return (
    <div className="rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-5">
      <div className="mb-4 flex items-center gap-2">
        <Title level={4} className="!mb-0 !mt-0 !text-base">
          Discussion
        </Title>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--ant-color-fill-tertiary)] px-2 text-xs font-semibold text-[var(--ant-color-text-secondary)]">
          {item.metrics.comments}
        </span>
      </div>

      <div className="flex flex-col">
        {commentApi.commentTree.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--ant-color-text-tertiary)]">
            No comments yet. Start the discussion below.
          </p>
        ) : (
          commentApi.commentTree.map((comment) => (
            <FeedDiscussionComment
              key={comment.id}
              comment={comment}
              depth={0}
              resolvedCommentIds={resolvedCommentIds}
              onToggleResolve={toggleResolve}
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
              onStartEdit={commentApi.handleStartEdit}
              onSaveEdit={commentApi.handleSaveEdit}
              onReplySubmit={commentApi.handleReplySubmit}
              onToggleReply={commentApi.toggleReplyForComment}
              onReplyValueChange={commentApi.setReplyValue}
              onEditValueChange={commentApi.setEditValue}
              onToggleReplyGroup={commentApi.toggleReplyGroup}
              onCancelEdit={commentApi.cancelEdit}
              onCancelReply={commentApi.cancelReply}
              onDeleteComment={commentApi.handleDeleteComment}
              onCommentReactionSelect={handleReactionSelect}
              onOpenCommentReactionPicker={commentApi.openCommentReactionPicker}
              onScheduleCommentReactionPickerClose={commentApi.scheduleCommentReactionPickerClose}
              onToggleCommentReactionPicker={commentApi.toggleCommentReactionPicker}
            />
          ))
        )}
      </div>

      <div className="mt-5">
        <FeedDiscussionComposer
          commentValue={commentApi.commentValue}
          onCommentValueChange={commentApi.setCommentValue}
          onCommentSubmit={commentApi.handleCommentSubmit}
          commenting={commenting}
        />
      </div>
    </div>
  );
};

export default FeedDiscussion;
