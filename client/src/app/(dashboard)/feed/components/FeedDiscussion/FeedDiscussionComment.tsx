import React from 'react';
import { Avatar, Button, Input, Modal, Typography } from 'antd';
import { CheckCircleOutlined, CheckCircleFilled, LikeOutlined } from '@ant-design/icons';
import type { FeedComment, ReactionType } from '@/services/socialFeedService';
import { formatTimeAgo } from '@/services/socialFeedService';
import { COMMENT_CHAR_LIMIT, reactionOptions } from '../FeedCard/constants';

const { Text } = Typography;

const reactionPalette: Record<ReactionType, { color: string; softBg: string }> = {
  like: { color: '#1877F2', softBg: 'rgba(24, 119, 242, 0.12)' },
  applause: { color: '#2E8B57', softBg: 'rgba(46, 139, 87, 0.14)' },
  celebrate: { color: '#6F58B0', softBg: 'rgba(111, 88, 176, 0.14)' },
  love: { color: '#D9643A', softBg: 'rgba(217, 100, 58, 0.14)' },
  insightful: { color: '#D9A321', softBg: 'rgba(217, 163, 33, 0.16)' },
  funny: { color: '#18AFC6', softBg: 'rgba(24, 175, 198, 0.14)' },
};

interface FeedDiscussionCommentProps {
  comment: FeedComment;
  depth: number;
  resolvedCommentIds: Set<string>;
  onToggleResolve: (commentId: string) => void;

  replyToCommentId: string | null;
  replyValue: string;
  editingCommentId: string | null;
  editValue: string;
  openCommentReactionId: string | null;
  animatingCommentReactionId: string | null;
  expandedReplyGroups: Record<string, boolean>;
  pendingReply: boolean;
  pendingEdit: boolean;
  pendingCommentReactionId: string | null;
  pendingDeleteCommentId: string | null;

  onStartEdit: (comment: FeedComment) => void;
  onSaveEdit: (commentId: string) => void;
  onReplySubmit: (commentId: string) => void;
  onToggleReply: (commentId: string) => void;
  onReplyValueChange: (value: string) => void;
  onEditValueChange: (value: string) => void;
  onToggleReplyGroup: (commentId: string) => void;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onDeleteComment: (commentId: string) => void;
  onCommentReactionSelect: (commentId: string, reaction: ReactionType) => void;
  onOpenCommentReactionPicker: (commentId: string) => void;
  onScheduleCommentReactionPickerClose: () => void;
  onToggleCommentReactionPicker: (commentId: string) => void;
}

/**
 * One comment row in the Discussion thread — recursive for nested replies.
 * Mirrors the nesting/indent pattern of FeedCard/FeedCardComments but adds:
 * job title next to the author name, an always-expanded layout, and a
 * "Resolve" toggle on top-level comments only (local-only, not persisted).
 */
const FeedDiscussionComment: React.FC<FeedDiscussionCommentProps> = ({
  comment,
  depth,
  resolvedCommentIds,
  onToggleResolve,
  replyToCommentId,
  replyValue,
  editingCommentId,
  editValue,
  openCommentReactionId,
  animatingCommentReactionId,
  expandedReplyGroups,
  pendingReply,
  pendingEdit,
  pendingCommentReactionId,
  pendingDeleteCommentId,
  onStartEdit,
  onSaveEdit,
  onReplySubmit,
  onToggleReply,
  onReplyValueChange,
  onEditValueChange,
  onToggleReplyGroup,
  onCancelEdit,
  onCancelReply,
  onDeleteComment,
  onCommentReactionSelect,
  onOpenCommentReactionPicker,
  onScheduleCommentReactionPickerClose,
  onToggleCommentReactionPicker,
}) => {
  const isReplying = replyToCommentId === comment.id;
  const isEditing = editingCommentId === comment.id;
  const isOwnComment = comment.canEdit;
  const replies = comment.replies || [];
  const showAllReplies = expandedReplyGroups[comment.id] || false;
  const visibleReplies = showAllReplies ? replies : replies.slice(0, 2);
  const selectedCommentReaction = comment.userReaction
    ? reactionOptions.find((option) => option.key === comment.userReaction)
    : null;
  const commentReactionLabel = selectedCommentReaction?.label || 'Like';

  const commentReactionBtnClass = comment.userReaction
    ? '!font-semibold'
    : '!text-[var(--ant-color-text-secondary)] hover:!text-[var(--ant-color-text)] hover:!bg-[var(--ant-color-bg-text-hover)]';

  const isCommentReactionAnimating = animatingCommentReactionId === comment.id;
  const isDeleting = pendingDeleteCommentId === comment.id;
  const isTopLevel = depth === 0;
  const isResolved = resolvedCommentIds.has(comment.id);
  const authorLabel = isOwnComment ? 'You' : comment.author.name;
  const authorTitle = comment.author.title?.trim();

  const confirmDelete = () => {
    Modal.confirm({
      title: 'Delete this comment?',
      content: replies.length > 0 ? 'This will delete the comment and its replies.' : 'This action cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => onDeleteComment(comment.id),
    });
  };

  const threadClassName = depth > 0 ? 'mt-3 ml-10 border-l-2 border-[var(--ant-color-border-secondary)] pl-4' : 'mt-4';
  const rowClassName = `flex gap-3 relative group ${isDeleting ? 'opacity-50 pointer-events-none' : ''} ${isResolved ? 'opacity-70' : ''}`;

  return (
    <div className={threadClassName}>
      <div className={rowClassName}>
        <Avatar
          size={32}
          src={comment.author.avatarUrl}
          className="shrink-0 mt-1 shadow-sm border border-[var(--ant-color-border-secondary)]"
        >
          {comment.author.name.charAt(0)}
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Text strong className="text-sm text-[var(--ant-color-text)] leading-none">
                {authorLabel}
              </Text>
              {authorTitle ? (
                <Text type="secondary" className="text-xs text-[var(--ant-color-text-tertiary)] leading-none">
                  {authorTitle}
                </Text>
              ) : null}
              {comment.isPostAuthor && !isOwnComment ? (
                <span className="bg-[var(--ant-color-primary)] text-white text-[10px] font-bold px-1.5 py-0.5 rounded leading-none tracking-wide">
                  AUTHOR
                </span>
              ) : null}
              <Text type="secondary" className="text-xs text-[var(--ant-color-text-secondary)] leading-none">
                &bull; {formatTimeAgo(comment.createdAt)}
                {comment.isEdited && <span className="ml-1 italic opacity-70">(edited)</span>}
              </Text>
            </div>

            {isTopLevel ? (
              <button
                type="button"
                className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                  isResolved
                    ? 'text-[var(--ant-color-text-tertiary)] hover:text-[var(--ant-color-text-secondary)]'
                    : 'text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-success)]'
                }`}
                onClick={() => onToggleResolve(comment.id)}
                title={isResolved ? 'Mark as unresolved' : 'Mark as resolved'}
              >
                {isResolved ? <CheckCircleFilled className="text-[var(--ant-color-text-tertiary)]" /> : <CheckCircleOutlined />}
                <span>{isResolved ? 'Resolved' : 'Resolve'}</span>
              </button>
            ) : null}
          </div>

          {isEditing ? (
            <div className="mt-2 flex flex-col gap-2">
              <Input.TextArea
                autoFocus
                value={editValue}
                onChange={(event) => onEditValueChange(event.target.value)}
                maxLength={COMMENT_CHAR_LIMIT}
                autoSize={{ minRows: 2, maxRows: 5 }}
                placeholder="Edit your comment"
                className="rounded-lg border-[var(--ant-color-border)] focus:border-[var(--ant-color-primary)] text-sm"
              />
              <div className="flex items-center justify-between mt-1">
                <Text type="secondary" className="text-xs text-[var(--ant-color-text-description)]">
                  {editValue.length}/{COMMENT_CHAR_LIMIT}
                </Text>
                <div className="flex items-center gap-2">
                  <Button size="small" onClick={onCancelEdit} className="text-xs">
                    Cancel
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    loading={pendingEdit}
                    onClick={() => onSaveEdit(comment.id)}
                    className="text-xs"
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[var(--ant-color-text)] leading-relaxed mt-1 break-words">
              {comment.content}
            </div>
          )}

          <div className="flex items-center gap-3 mt-1.5">
            <div
              className="feed-card-comment-react-picker relative flex items-center"
              onMouseEnter={() => {
                if (pendingCommentReactionId !== null) return;
                onOpenCommentReactionPicker(comment.id);
              }}
              onMouseLeave={onScheduleCommentReactionPickerClose}
            >
              {openCommentReactionId === comment.id ? (
                <div
                  className="absolute bottom-full mb-1 left-0 bg-[var(--ant-color-bg-elevated)] border border-[var(--ant-color-border-secondary)] shadow-md rounded-full px-1.5 py-1.5 flex gap-1 z-20"
                  role="menu"
                  aria-label="Choose comment reaction"
                >
                  {reactionOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`p-1.5 rounded-full transition-all hover:scale-110 ${comment.userReaction === option.key ? 'ring-2 ring-[var(--ant-color-border)] scale-110' : ''}`}
                      style={{
                        color: reactionPalette[option.key].color,
                        backgroundColor:
                          comment.userReaction === option.key ? reactionPalette[option.key].softBg : 'transparent',
                      }}
                      onClick={() => onCommentReactionSelect(comment.id, option.key)}
                      aria-label={option.label}
                      title={option.label}
                      disabled={pendingCommentReactionId === comment.id}
                    >
                      {option.icon}
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                className={`flex items-center gap-1 text-xs font-semibold transition-colors ${commentReactionBtnClass} ${isCommentReactionAnimating ? 'animate-bounce' : ''}`}
                style={
                  comment.userReaction
                    ? {
                        color: reactionPalette[comment.userReaction].color,
                      }
                    : undefined
                }
                onClick={() => onToggleCommentReactionPicker(comment.id)}
              >
                <span className="text-sm">{selectedCommentReaction?.icon || <LikeOutlined />}</span>
                <span className="sr-only">{commentReactionLabel}</span>
                <span>Like{comment.reactionCount ? ` (${comment.reactionCount})` : ''}</span>
              </button>
            </div>

            <button
              type="button"
              className={`text-xs font-semibold hover:text-[var(--ant-color-text)] transition-colors ${isReplying ? 'text-[var(--ant-color-text)]' : 'text-[var(--ant-color-text-secondary)]'}`}
              onClick={() => onToggleReply(comment.id)}
            >
              Reply
            </button>

            {comment.canEdit ? (
              <>
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)] transition-colors"
                  onClick={() => onStartEdit(comment)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-error)] transition-colors disabled:opacity-50"
                  onClick={confirmDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </>
            ) : null}
          </div>

          {isReplying ? (
            <div className="mt-3 flex flex-col gap-2">
              <Input.TextArea
                autoFocus
                value={replyValue}
                onChange={(event) => onReplyValueChange(event.target.value)}
                maxLength={COMMENT_CHAR_LIMIT}
                autoSize={{ minRows: 2, maxRows: 4 }}
                placeholder="Write a reply... Use @username for mentions"
                className="rounded-lg border-[var(--ant-color-border)] focus:border-[var(--ant-color-primary)] text-sm"
              />
              <div className="flex items-center justify-between">
                <Text type="secondary" className="text-xs text-[var(--ant-color-text-description)]">
                  {replyValue.length}/{COMMENT_CHAR_LIMIT}
                </Text>
                <div className="flex gap-2">
                  <Button size="small" onClick={onCancelReply}>
                    Cancel
                  </Button>
                  <Button size="small" type="primary" loading={pendingReply} onClick={() => onReplySubmit(comment.id)}>
                    Reply
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {replies.length > 0 ? (
        <div className="flex flex-col gap-1">
          {visibleReplies.map((reply) => (
            <FeedDiscussionComment
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              resolvedCommentIds={resolvedCommentIds}
              onToggleResolve={onToggleResolve}
              replyToCommentId={replyToCommentId}
              replyValue={replyValue}
              editingCommentId={editingCommentId}
              editValue={editValue}
              openCommentReactionId={openCommentReactionId}
              animatingCommentReactionId={animatingCommentReactionId}
              expandedReplyGroups={expandedReplyGroups}
              pendingReply={pendingReply}
              pendingEdit={pendingEdit}
              pendingCommentReactionId={pendingCommentReactionId}
              pendingDeleteCommentId={pendingDeleteCommentId}
              onStartEdit={onStartEdit}
              onSaveEdit={onSaveEdit}
              onReplySubmit={onReplySubmit}
              onToggleReply={onToggleReply}
              onReplyValueChange={onReplyValueChange}
              onEditValueChange={onEditValueChange}
              onToggleReplyGroup={onToggleReplyGroup}
              onCancelEdit={onCancelEdit}
              onCancelReply={onCancelReply}
              onDeleteComment={onDeleteComment}
              onCommentReactionSelect={onCommentReactionSelect}
              onOpenCommentReactionPicker={onOpenCommentReactionPicker}
              onScheduleCommentReactionPickerClose={onScheduleCommentReactionPickerClose}
              onToggleCommentReactionPicker={onToggleCommentReactionPicker}
            />
          ))}
          {replies.length > 2 ? (
            <button
              type="button"
              className="text-xs font-semibold text-[var(--ant-color-primary)] hover:text-[var(--ant-color-primary-hover)] bg-transparent py-1.5 px-3 rounded-full hover:bg-[var(--ant-color-primary-bg)] transition-colors w-max ml-10 mt-1"
              onClick={() => onToggleReplyGroup(comment.id)}
            >
              {showAllReplies ? 'Hide replies' : `View ${replies.length} replies`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default FeedDiscussionComment;
