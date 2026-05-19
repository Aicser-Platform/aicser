import React from 'react';
import { Avatar, Button, Input, Modal, Tag, Typography } from 'antd';
import { DownOutlined, LikeOutlined, UndoOutlined, UpOutlined } from '@ant-design/icons';
import type { FeedComment, FeedItem, ReactionType } from '@/services/socialFeedService';
import { formatTimeAgo } from '@/services/socialFeedService';
import { COMMENT_CHAR_LIMIT, reactionOptions } from './constants';

const { Text } = Typography;

interface FeedCardCommentsProps {
  item: FeedItem;
  compact: boolean;
  commentValue: string;
  showCommentBox: boolean;
  showCommentsList: boolean;
  commentTree: FeedComment[];
  loadingComments: boolean;
  expandedComments: boolean;
  hasMoreComments: boolean;
  hasCommentListToggle: boolean;
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
  onCommentValueChange: (value: string) => void;
  onToggleCommentsList: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleAllComments: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onCommentSubmit: () => void;
  onStartEdit: (comment: FeedComment) => void;
  onSaveEdit: (commentId: string) => void;
  onReplySubmit: (commentId: string) => void;
  onToggleReply: (commentId: string) => void;
  onReplyValueChange: (value: string) => void;
  onEditValueChange: (value: string) => void;
  onToggleReplyGroup: (commentId: string) => void;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onCloseCommentBox: () => void;
  onDeleteComment: (commentId: string) => void;
  onCommentReactionSelect: (commentId: string, reaction: ReactionType) => void;
  onOpenCommentReactionPicker: (commentId: string) => void;
  onScheduleCommentReactionPickerClose: () => void;
  onToggleCommentReactionPicker: (commentId: string) => void;
  stopPropagation: (event: React.MouseEvent<HTMLElement>) => void;
}

const FeedCardComments: React.FC<FeedCardCommentsProps> = ({
  item,
  compact,
  commentValue,
  showCommentBox,
  showCommentsList,
  commentTree,
  loadingComments,
  expandedComments,
  hasMoreComments,
  hasCommentListToggle,
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
  onCommentValueChange,
  onToggleCommentsList,
  onToggleAllComments,
  onCommentSubmit,
  onStartEdit,
  onSaveEdit,
  onReplySubmit,
  onToggleReply,
  onReplyValueChange,
  onEditValueChange,
  onToggleReplyGroup,
  onCancelEdit,
  onCancelReply,
  onCloseCommentBox,
  onDeleteComment,
  onCommentReactionSelect,
  onOpenCommentReactionPicker,
  onScheduleCommentReactionPickerClose,
  onToggleCommentReactionPicker,
  stopPropagation,
}) => {
  const renderComment = (comment: FeedComment, depth = 0) => {
    const isReplying = replyToCommentId === comment.id;
    const isEditing = editingCommentId === comment.id;
    const isOwnComment = comment.canEdit;
    const replies = comment.replies || [];
    const showAllReplies = expandedReplyGroups[comment.id] || false;
    const visibleReplies = showAllReplies ? replies : replies.slice(0, 2);
    const selectedCommentReaction = comment.userReaction
      ? reactionOptions.find((option) => option.key === comment.userReaction)
      : null;
    const commentReactionLabel = selectedCommentReaction?.label || 'React';

    const reactionPalette: Record<ReactionType, { color: string; softBg: string }> = {
      like: { color: '#1877F2', softBg: 'rgba(24, 119, 242, 0.12)' },
      applause: { color: '#2E8B57', softBg: 'rgba(46, 139, 87, 0.14)' },
      celebrate: { color: '#6F58B0', softBg: 'rgba(111, 88, 176, 0.14)' },
      love: { color: '#D9643A', softBg: 'rgba(217, 100, 58, 0.14)' },
      insightful: { color: '#D9A321', softBg: 'rgba(217, 163, 33, 0.16)' },
      funny: { color: '#18AFC6', softBg: 'rgba(24, 175, 198, 0.14)' },
    };

    const commentReactionBtnClass = comment.userReaction
      ? '!font-semibold'
      : '!text-[var(--ant-color-text-secondary)] hover:!text-[var(--ant-color-text)] hover:!bg-[var(--ant-color-bg-text-hover)]';

    const isCommentReactionAnimating = animatingCommentReactionId === comment.id;
    const isDeleting = pendingDeleteCommentId === comment.id;

    const confirmDelete = () => {
      Modal.confirm({
        title: 'Delete this comment?',
        content: replies.length > 0 ? 'This will delete the comment and its replies.' : 'This action cannot be undone.',
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: () => onDeleteComment(comment.id),
      });
    };

    const threadClassName = `pl-${Math.min(depth, 3) * 6} ${depth > 0 ? 'mt-3 border-l-2 border-[var(--ant-color-border-secondary)]' : 'mt-4'}`;
    const commentClassName = `flex gap-3 relative group ${isDeleting ? 'opacity-50 pointer-events-none' : ''}`;
    const authorLabel = isOwnComment ? 'You' : comment.author.name;

    return (
      <div key={comment.id} className={threadClassName}>
        <div className={commentClassName}>
          <Avatar
            size={32}
            src={comment.author.avatarUrl}
            className="shrink-0 mt-1 shadow-sm border border-[var(--ant-color-border-secondary)]"
          >
            {comment.author.name.charAt(0)}
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="bg-[var(--ant-color-bg-layout)] border border-[var(--ant-color-border-secondary)] rounded-xl px-3.5 py-2.5 flex flex-col gap-1 w-full relative">
              <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                <Text strong className="text-sm text-[var(--ant-color-text)] leading-none">
                  {authorLabel}
                </Text>
                {comment.isPostAuthor && !isOwnComment ? (
                  <span className="bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)] text-[10px] font-bold px-1.5 py-0.5 rounded leading-none">
                    Author
                  </span>
                ) : null}
                <Text type="secondary" className="text-xs text-[var(--ant-color-text-secondary)] leading-none ml-auto">
                  {formatTimeAgo(comment.createdAt)}
                  {comment.isEdited && <span className="ml-1 italic opacity-70">(edited)</span>}
                </Text>
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
                  <div className="flex items-center justify-between mt-2">
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
            </div>

            <div className="flex items-center gap-3 mt-1.5 ml-2">
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

              <div
                className="relative flex items-center"
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
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold transition-colors ${commentReactionBtnClass} ${isCommentReactionAnimating ? 'animate-bounce' : ''}`}
                  style={
                    comment.userReaction
                      ? {
                          color: reactionPalette[comment.userReaction].color,
                          backgroundColor: reactionPalette[comment.userReaction].softBg,
                        }
                      : undefined
                  }
                  onClick={() => onToggleCommentReactionPicker(comment.id)}
                >
                  <span className="text-sm">{selectedCommentReaction?.icon || <LikeOutlined />}</span>
                  <span className="sr-only">{commentReactionLabel}</span>
                  <span>{comment.reactionCount || 0}</span>
                </button>
              </div>
            </div>

            {isReplying ? (
              <div className="mt-3 flex flex-col gap-2 relative">
                <div className="absolute -left-6 top-0 bottom-0 w-px bg-[var(--ant-color-border-secondary)]" />
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
                    <Button
                      size="small"
                      type="primary"
                      loading={pendingReply}
                      onClick={() => onReplySubmit(comment.id)}
                    >
                      Reply
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {replies.length > 0 ? (
          <div className="flex flex-col gap-1 mt-1">
            {visibleReplies.map((reply) => renderComment(reply, depth + 1))}
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

  return (
    <>
      {showCommentBox && (
        <div
          className="p-4 border-t border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-layout)] flex flex-col gap-3"
          onClick={stopPropagation}
        >
          <Input.TextArea
            value={commentValue}
            onChange={(event) => onCommentValueChange(event.target.value)}
            placeholder="Write a comment... Use @username for mentions"
            maxLength={COMMENT_CHAR_LIMIT}
            autoSize={{ minRows: 2, maxRows: 4 }}
            className="rounded-xl border-[var(--ant-color-border)] focus:border-[var(--ant-color-primary)] shadow-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--ant-color-text-description)] font-medium">
              {commentValue.length}/{COMMENT_CHAR_LIMIT}
            </span>
            <div className="flex gap-2">
              <Button
                onClick={onCloseCommentBox}
                className="h-8 rounded-md font-medium text-sm hover:bg-[var(--ant-color-bg-text-hover)] text-[var(--ant-color-text)] border-none shadow-none bg-transparent"
              >
                Cancel
              </Button>
              <Button
                type="primary"
                onClick={onCommentSubmit}
                className="h-8 rounded-md font-medium text-sm shadow-sm border-0"
              >
                Post
              </Button>
            </div>
          </div>
        </div>
      )}

      {hasCommentListToggle && (
        <button
          type="button"
          className="w-full flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)] transition-colors border-t border-[var(--ant-color-border-secondary)] border-dashed"
          onClick={onToggleCommentsList}
        >
          {showCommentsList ? (
            <UpOutlined className="text-xs opacity-70" />
          ) : (
            <DownOutlined className="text-xs opacity-70" />
          )}
          <span>{showCommentsList ? 'Hide comments' : `View comments (${item.metrics.comments})`}</span>
        </button>
      )}

      {showCommentsList && (commentTree.length > 0 || (compact && item.metrics.comments > 0)) && (
        <div
          className={`flex flex-col border-t border-[var(--ant-color-border-secondary)] ${compact ? 'px-4 pb-4' : 'px-6 pb-6'}`}
          onClick={stopPropagation}
        >
          {commentTree.map((comment) => renderComment(comment))}
          {compact && loadingComments && (
            <div className="text-center py-6 text-sm text-[var(--ant-color-text-secondary)] font-medium flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-[var(--ant-color-primary)] border-t-transparent rounded-full animate-spin"></div>{' '}
              Loading comments...
            </div>
          )}
          {compact && (hasMoreComments || expandedComments) && (
            <button
              type="button"
              className="mt-4 mx-auto block text-sm font-semibold text-[var(--ant-color-primary)] hover:text-[var(--ant-color-primary-hover)] bg-transparent py-2 px-4 rounded-full hover:bg-[var(--ant-color-primary-bg)] transition-colors"
              onClick={onToggleAllComments}
            >
              {expandedComments ? 'Show fewer comments' : `Show all comments (${item.metrics.comments})`}
            </button>
          )}
          {compact && !loadingComments && commentTree.length === 0 && item.metrics.comments > 0 && (
            <button
              type="button"
              className="mt-4 mx-auto block text-sm font-semibold text-[var(--ant-color-primary)] hover:text-[var(--ant-color-primary-hover)] bg-transparent py-2 px-4 rounded-full hover:bg-[var(--ant-color-primary-bg)] transition-colors"
              onClick={onToggleAllComments}
            >
              Show comments ({item.metrics.comments})
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default FeedCardComments;
