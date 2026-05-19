'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { message } from 'antd';
import type { FeedComment, FeedItem, ReactionType } from '@/services/socialFeedService';
import { socialFeedService } from '@/services/socialFeedService';
import { COMMENT_CHAR_LIMIT } from './constants';
import {
  applyReactionMap,
  countComments,
  findCommentInTree,
  normalizeCommentTree,
  removeCommentFromTree,
  updateCommentInTree,
} from './commentUtils';

interface UseFeedCardCommentsArgs {
  item: FeedItem;
  compact: boolean;
  onAddComment: (itemId: string, content: string, parentCommentId?: string) => Promise<void> | void;
  onCommentDeleted?: (itemId: string, commentCount: number) => void;
  commenting: boolean;
}

const useFeedCardComments = ({ item, compact, onAddComment, onCommentDeleted, commenting }: UseFeedCardCommentsArgs) => {
  const [commentValue, setCommentValue] = useState('');
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [expandedComments, setExpandedComments] = useState(false);
  const [fullComments, setFullComments] = useState<FeedComment[] | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentTree, setCommentTree] = useState<FeedComment[]>([]);

  const [replyToCommentId, setReplyToCommentId] = useState<string | null>(null);
  const [replyValue, setReplyValue] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [openCommentReactionId, setOpenCommentReactionId] = useState<string | null>(null);
  const [animatingCommentReactionId, setAnimatingCommentReactionId] = useState<string | null>(null);
  const [expandedReplyGroups, setExpandedReplyGroups] = useState<Record<string, boolean>>({});
  const [showCommentsList, setShowCommentsList] = useState(false);

  const [pendingReply, setPendingReply] = useState(false);
  const [pendingEdit, setPendingEdit] = useState(false);
  const [pendingCommentReactionId, setPendingCommentReactionId] = useState<string | null>(null);
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<string | null>(null);

  const commentReactionAnimationTimerRef = useRef<number | null>(null);
  const commentReactionCloseTimerRef = useRef<number | null>(null);

  const visibleComments = useMemo(
    () => normalizeCommentTree(compact ? (item.recentComments ?? []).slice(0, 3) : (item.recentComments ?? [])),
    [compact, item.recentComments],
  );

  const hasMoreComments = item.metrics.comments > countComments(visibleComments);

  const clearCommentReactionAnimationTimer = useCallback(() => {
    if (commentReactionAnimationTimerRef.current !== null) {
      window.clearTimeout(commentReactionAnimationTimerRef.current);
      commentReactionAnimationTimerRef.current = null;
    }
  }, []);

  const clearCommentReactionCloseTimer = useCallback(() => {
    if (commentReactionCloseTimerRef.current !== null) {
      window.clearTimeout(commentReactionCloseTimerRef.current);
      commentReactionCloseTimerRef.current = null;
    }
  }, []);

  const playCommentReactionAnimation = useCallback(
    (commentId: string) => {
      clearCommentReactionAnimationTimer();
      setAnimatingCommentReactionId(commentId);
      commentReactionAnimationTimerRef.current = window.setTimeout(() => {
        setAnimatingCommentReactionId((prev) => (prev === commentId ? null : prev));
        commentReactionAnimationTimerRef.current = null;
      }, 260);
    },
    [clearCommentReactionAnimationTimer],
  );

  const openCommentReactionPicker = useCallback(
    (commentId: string) => {
      clearCommentReactionCloseTimer();
      setOpenCommentReactionId(commentId);
    },
    [clearCommentReactionCloseTimer],
  );

  const scheduleCommentReactionPickerClose = useCallback(() => {
    clearCommentReactionCloseTimer();
    commentReactionCloseTimerRef.current = window.setTimeout(() => {
      setOpenCommentReactionId(null);
    }, 140);
  }, [clearCommentReactionCloseTimer]);

  const toggleCommentReactionPicker = useCallback(
    (commentId: string) => {
      clearCommentReactionCloseTimer();
      setOpenCommentReactionId((prev) => (prev === commentId ? null : commentId));
    },
    [clearCommentReactionCloseTimer],
  );

  const closeCommentReactionPicker = useCallback(() => {
    setOpenCommentReactionId(null);
  }, []);

  useEffect(() => {
    setExpandedComments(false);
    setFullComments(null);
    setLoadingComments(false);
    clearCommentReactionAnimationTimer();
    clearCommentReactionCloseTimer();
    setCommentTree(visibleComments);
    setReplyToCommentId(null);
    setReplyValue('');
    setEditingCommentId(null);
    setEditValue('');
    setOpenCommentReactionId(null);
    setAnimatingCommentReactionId(null);
    setExpandedReplyGroups({});
    setShowCommentsList(false);
    setPendingDeleteCommentId(null);
  }, [item.id, visibleComments, clearCommentReactionAnimationTimer, clearCommentReactionCloseTimer]);

  useEffect(() => {
    return () => {
      clearCommentReactionAnimationTimer();
      clearCommentReactionCloseTimer();
    };
  }, [clearCommentReactionAnimationTimer, clearCommentReactionCloseTimer]);

  useEffect(() => {
    if (!openCommentReactionId) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.closest('.feed-card-comment-react-picker')) {
        setOpenCommentReactionId(null);
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, [openCommentReactionId]);

  const refreshComments = useCallback(
    async (forceExpanded: boolean) => {
      const fullItem = await socialFeedService.getItemById(item.id);
      if (!fullItem) return;
      const normalized = normalizeCommentTree(fullItem.recentComments || []);

      if (forceExpanded) {
        setFullComments(normalized);
        setCommentTree(normalized);
      } else {
        const collapsed = compact ? normalized.slice(0, 3) : normalized;
        setCommentTree(collapsed);
      }
    },
    [compact, item.id],
  );

  const handleToggleAllComments = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (expandedComments) {
      setExpandedComments(false);
      setCommentTree(visibleComments);
      return;
    }

    if (fullComments) {
      setExpandedComments(true);
      setCommentTree(fullComments);
      return;
    }

    if (loadingComments) return;

    setLoadingComments(true);
    try {
      const fullItem = await socialFeedService.getItemById(item.id);
      const fetchedComments = normalizeCommentTree(fullItem?.recentComments || []);
      const next = fetchedComments.length > 0 ? fetchedComments : visibleComments;
      setFullComments(next);
      setCommentTree(next);
      setExpandedComments(true);
    } finally {
      setLoadingComments(false);
    }
  };

  const handleToggleCommentsList = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    if (showCommentsList) {
      setShowCommentsList(false);
      setReplyToCommentId(null);
      setOpenCommentReactionId(null);
      return;
    }

    setShowCommentsList(true);

    if (compact && item.metrics.comments > 0 && commentTree.length === 0 && !loadingComments) {
      setLoadingComments(true);
      try {
        const fullItem = await socialFeedService.getItemById(item.id);
        const fetchedComments = normalizeCommentTree(fullItem?.recentComments || []);
        const next = fetchedComments.length > 0 ? fetchedComments : visibleComments;
        setFullComments(next);
        setCommentTree(next);
        setExpandedComments(true);
      } finally {
        setLoadingComments(false);
      }
    }
  };

  const handleCommentSubmit = async () => {
    const trimmed = commentValue.trim();
    if (!trimmed || commenting || trimmed.length > COMMENT_CHAR_LIMIT) return;
    await onAddComment(item.id, trimmed);
    setCommentValue('');
    setShowCommentBox(false);
    await refreshComments(expandedComments);
    setShowCommentsList(true);
  };

  const handleReplySubmit = async (commentId: string) => {
    const trimmed = replyValue.trim();
    if (!trimmed || pendingReply || trimmed.length > COMMENT_CHAR_LIMIT) return;

    setPendingReply(true);
    try {
      await onAddComment(item.id, trimmed, commentId);
      setReplyValue('');
      setReplyToCommentId(null);
      setExpandedReplyGroups((prev) => ({ ...prev, [commentId]: true }));
      await refreshComments(true);
      setExpandedComments(true);
      setShowCommentsList(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Unable to add reply');
    } finally {
      setPendingReply(false);
    }
  };

  const handleStartEdit = (comment: FeedComment) => {
    setEditingCommentId(comment.id);
    setEditValue(comment.content);
  };

  const handleSaveEdit = async (commentId: string) => {
    const trimmed = editValue.trim();
    if (!trimmed || pendingEdit || trimmed.length > COMMENT_CHAR_LIMIT) return;

    setPendingEdit(true);
    try {
      const response = await socialFeedService.updateComment(item.id, commentId, trimmed);
      setCommentTree((prev) =>
        updateCommentInTree(prev, commentId, (existing) => ({
          ...existing,
          ...response.comment,
          replies: existing.replies || response.comment.replies || [],
        })),
      );
      setEditingCommentId(null);
      setEditValue('');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Unable to update comment');
    } finally {
      setPendingEdit(false);
    }
  };

  const handleCommentReactionSelect = async (commentId: string, reaction: ReactionType) => {
    if (pendingCommentReactionId) return;

    const target = findCommentInTree(commentTree, commentId);
    if (!target) return;

    playCommentReactionAnimation(commentId);

    const previousReaction = target.userReaction;
    const previousMap = target.reactions || {};
    const nextReaction = previousReaction === reaction ? undefined : reaction;
    const optimisticMap = applyReactionMap(previousMap, previousReaction, nextReaction);

    setCommentTree((prev) =>
      updateCommentInTree(prev, commentId, (existing) => ({
        ...existing,
        reactions: optimisticMap,
        reactionCount: Math.max(0, (existing.reactionCount || 0) + (previousReaction ? 0 : 1) - (nextReaction ? 0 : 1)),
        userReaction: nextReaction,
      })),
    );

    setPendingCommentReactionId(commentId);
    setOpenCommentReactionId(null);
    try {
      const response = await socialFeedService.reactToComment(item.id, commentId, reaction);
      setCommentTree((prev) =>
        updateCommentInTree(prev, commentId, (existing) => ({
          ...existing,
          reactions: applyReactionMap(existing.reactions || {}, existing.userReaction, response.reaction),
          reactionCount: Math.max(0, response.reaction_count),
          userReaction: response.reaction,
        })),
      );
    } catch (error) {
      setCommentTree((prev) =>
        updateCommentInTree(prev, commentId, (existing) => ({
          ...existing,
          reactions: previousMap,
          reactionCount: target.reactionCount || 0,
          userReaction: previousReaction,
        })),
      );
      message.error(error instanceof Error ? error.message : 'Unable to react to comment');
    } finally {
      setPendingCommentReactionId(null);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (pendingDeleteCommentId) return;

    const existing = findCommentInTree(commentTree, commentId);
    if (!existing) return;

    const previousTree = commentTree;
    const previousFull = fullComments;

    const removal = removeCommentFromTree(commentTree, commentId);
    const fullRemoval = fullComments ? removeCommentFromTree(fullComments, commentId) : null;

    if (removal.removedCount === 0) return;

    setPendingDeleteCommentId(commentId);
    setCommentTree(removal.next);
    if (fullRemoval) {
      setFullComments(fullRemoval.next);
    }

    if (removal.removedIds.includes(replyToCommentId || '')) {
      setReplyToCommentId(null);
      setReplyValue('');
    }
    if (removal.removedIds.includes(editingCommentId || '')) {
      setEditingCommentId(null);
      setEditValue('');
    }
    if (removal.removedIds.includes(openCommentReactionId || '')) {
      setOpenCommentReactionId(null);
    }

    try {
      const response = await socialFeedService.deleteComment(item.id, commentId);
      if (onCommentDeleted) {
        onCommentDeleted(item.id, response.comment_count);
      }
    } catch (error) {
      setCommentTree(previousTree);
      setFullComments(previousFull);
      message.error(error instanceof Error ? error.message : 'Unable to delete comment');
    } finally {
      setPendingDeleteCommentId(null);
    }
  };

  const toggleCommentBox = useCallback(() => {
    setShowCommentBox((prev) => !prev);
    setShowCommentsList(true);
  }, []);

  const closeCommentBox = useCallback(() => {
    setShowCommentBox(false);
  }, []);

  const toggleReplyForComment = useCallback((commentId: string) => {
    setReplyToCommentId((prev) => (prev === commentId ? null : commentId));
    setReplyValue('');
  }, []);

  const cancelReply = useCallback(() => {
    setReplyToCommentId(null);
    setReplyValue('');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingCommentId(null);
    setEditValue('');
  }, []);

  const toggleReplyGroup = useCallback((commentId: string) => {
    setExpandedReplyGroups((prev) => ({
      ...prev,
      [commentId]: !prev[commentId],
    }));
  }, []);

  return {
    commentValue,
    setCommentValue,
    showCommentBox,
    toggleCommentBox,
    closeCommentBox,
    showCommentsList,
    commentTree,
    loadingComments,
    expandedComments,
    hasMoreComments,
    replyToCommentId,
    replyValue,
    setReplyValue,
    editingCommentId,
    editValue,
    setEditValue,
    openCommentReactionId,
    animatingCommentReactionId,
    expandedReplyGroups,
    pendingReply,
    pendingEdit,
    pendingCommentReactionId,
    pendingDeleteCommentId,
    handleToggleAllComments,
    handleToggleCommentsList,
    handleCommentSubmit,
    handleReplySubmit,
    handleStartEdit,
    handleSaveEdit,
    handleDeleteComment,
    handleCommentReactionSelect,
    openCommentReactionPicker,
    scheduleCommentReactionPickerClose,
    toggleCommentReactionPicker,
    clearCommentReactionCloseTimer,
    closeCommentReactionPicker,
    toggleReplyForComment,
    toggleReplyGroup,
    cancelReply,
    cancelEdit,
  };
};

export default useFeedCardComments;
