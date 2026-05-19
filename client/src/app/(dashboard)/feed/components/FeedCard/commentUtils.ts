import type { FeedComment, ReactionType } from '@/services/socialFeedService';

export const normalizeCommentTree = (comments: FeedComment[]): FeedComment[] =>
  comments.map((comment) => ({
    ...comment,
    replies: normalizeCommentTree(comment.replies || []),
    reactions: comment.reactions || {},
    reactionCount: comment.reactionCount || 0,
  }));

export const countComments = (comments: FeedComment[]): number =>
  comments.reduce((total, comment) => total + 1 + countComments(comment.replies || []), 0);

export const updateCommentInTree = (
  comments: FeedComment[],
  commentId: string,
  updater: (comment: FeedComment) => FeedComment,
): FeedComment[] =>
  comments.map((comment) => {
    if (comment.id === commentId) {
      return updater(comment);
    }
    if (!comment.replies?.length) {
      return comment;
    }
    return {
      ...comment,
      replies: updateCommentInTree(comment.replies, commentId, updater),
    };
  });

export const findCommentInTree = (comments: FeedComment[], commentId: string): FeedComment | null => {
  for (const comment of comments) {
    if (comment.id === commentId) return comment;
    if (comment.replies?.length) {
      const nested = findCommentInTree(comment.replies, commentId);
      if (nested) return nested;
    }
  }
  return null;
};

export const applyReactionMap = (
  current: Partial<Record<ReactionType, number>>,
  previous: ReactionType | undefined,
  next: ReactionType | undefined,
): Partial<Record<ReactionType, number>> => {
  const updated: Partial<Record<ReactionType, number>> = { ...current };

  if (previous) {
    const previousCount = Math.max(0, (updated[previous] || 0) - 1);
    if (previousCount === 0) {
      delete updated[previous];
    } else {
      updated[previous] = previousCount;
    }
  }

  if (next) {
    updated[next] = (updated[next] || 0) + 1;
  }

  return updated;
};

export const removeCommentFromTree = (
  comments: FeedComment[],
  commentId: string,
): { next: FeedComment[]; removedCount: number; removedIds: string[] } => {
  const removedIds: string[] = [];
  let removedCount = 0;

  const collectIds = (comment: FeedComment) => {
    removedIds.push(comment.id);
    if (comment.replies?.length) {
      comment.replies.forEach(collectIds);
    }
  };

  const next = comments.reduce<FeedComment[]>((acc, comment) => {
    if (comment.id === commentId) {
      collectIds(comment);
      removedCount += 1 + countComments(comment.replies || []);
      return acc;
    }

    if (comment.replies?.length) {
      const result = removeCommentFromTree(comment.replies, commentId);
      if (result.removedCount > 0) {
        removedCount += result.removedCount;
        removedIds.push(...result.removedIds);
        acc.push({
          ...comment,
          replies: result.next,
          replyCount: result.next.length,
        });
        return acc;
      }
    }

    acc.push(comment);
    return acc;
  }, []);

  return { next, removedCount, removedIds };
};
