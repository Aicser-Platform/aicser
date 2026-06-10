import type { FeedItem } from '@/services/socialFeedService';

export type ItemInteractionKey = 'reacting' | 'saving' | 'commenting' | 'following' | 'deleting';

export type ItemInteractionState = Record<ItemInteractionKey, boolean>;

export const EMPTY_ITEM_INTERACTION_STATE: ItemInteractionState = {
  reacting: false,
  saving: false,
  commenting: false,
  following: false,
  deleting: false,
};

export const upsertCommentInThread = (
  comments: FeedItem['recentComments'],
  comment: FeedItem['recentComments'][number]
) => {
  const parentId = comment.parentCommentId;
  if (!parentId) {
    return [comment, ...comments.filter((existing) => existing.id !== comment.id)].slice(0, 3);
  }

  const attachReply = (nodes: FeedItem['recentComments']): FeedItem['recentComments'] =>
    nodes.map((node) => {
      if (node.id === parentId) {
        const nextReplies = [...(node.replies || []).filter((reply) => reply.id !== comment.id), comment];
        return {
          ...node,
          replies: nextReplies,
          replyCount: nextReplies.length,
        };
      }
      if (!node.replies?.length) return node;
      return {
        ...node,
        replies: attachReply(node.replies),
      };
    });

  return attachReply(comments);
};

export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
