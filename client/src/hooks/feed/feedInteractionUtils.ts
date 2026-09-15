import type { FeedItem } from '@/services/socialFeedService';

export type ItemInteractionKey = 'reacting' | 'saving' | 'commenting' | 'following' | 'deleting' | 'updatingPost';

export type ItemInteractionState = Record<ItemInteractionKey, boolean>;

export const EMPTY_ITEM_INTERACTION_STATE: ItemInteractionState = {
  reacting: false,
  saving: false,
  commenting: false,
  following: false,
  deleting: false,
  updatingPost: false,
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

/**
 * A backend-rejected request (permission denied, validation failure, etc.) throws
 * `ApiError` (client/src/utils/api.ts) with a real, user-facing `.message` — safe to
 * show directly. A request that never reached the server (offline, DNS failure, CORS)
 * throws a raw `TypeError` from fetch() itself (commonly "TypeError: fetch failed" /
 * "Failed to fetch") — that string means nothing to an end user and was being shown
 * verbatim in the comment/reaction/save error toasts. Fall back to `fallback` for
 * exactly that case; every other Error subtype (ApiError included) still surfaces its
 * real message.
 */
export const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof TypeError) return fallback;
  return error instanceof Error && error.message ? error.message : fallback;
};
