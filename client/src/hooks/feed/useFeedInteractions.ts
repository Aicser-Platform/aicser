'use client';

import { useCallback, useRef, useState } from 'react';
import { message } from 'antd';
import { useTranslations } from 'next-intl';
import type { FeedItem, ReactionType } from '@/services/socialFeedService';
import { socialFeedService } from '@/services/socialFeedService';
import {
  EMPTY_ITEM_INTERACTION_STATE,
  errorMessage,
  type ItemInteractionKey,
  type ItemInteractionState,
  upsertCommentInThread,
} from './feedInteractionUtils';

export interface UseFeedInteractionsOptions {
  onSidebarRefresh?: () => void | Promise<void>;
  messagesNamespace?: 'feed_page' | 'feed';
}

export function useFeedInteractions(
  items: FeedItem[],
  setItems: React.Dispatch<React.SetStateAction<FeedItem[]>>,
  options: UseFeedInteractionsOptions = {}
) {
  const t = useTranslations(options.messagesNamespace ?? 'feed_page');
  const [pendingInteractions, setPendingInteractions] = useState<Record<string, ItemInteractionState>>({});
  const itemsRef = useRef<FeedItem[]>(items);
  const reactingItemsRef = useRef<Set<string>>(new Set());
  const savingItemsRef = useRef<Set<string>>(new Set());
  const commentingItemsRef = useRef<Set<string>>(new Set());
  const followingAuthorsRef = useRef<Set<string>>(new Set());
  const deletingItemsRef = useRef<Set<string>>(new Set());

  itemsRef.current = items;

  const updateItem = useCallback(
    (itemId: string, updater: (item: FeedItem) => FeedItem) => {
      setItems((prev) => {
        const next = prev.map((item) => (item.id === itemId ? updater(item) : item));
        itemsRef.current = next;
        return next;
      });
    },
    [setItems]
  );

  const updateItemsByAuthor = useCallback(
    (authorId: string, updater: (item: FeedItem) => FeedItem) => {
      setItems((prev) => {
        const next = prev.map((item) => (item.author?.id === authorId ? updater(item) : item));
        itemsRef.current = next;
        return next;
      });
    },
    [setItems]
  );

  const setInteractionPending = useCallback((itemId: string, key: ItemInteractionKey, value: boolean) => {
    setPendingInteractions((prev) => {
      const current = prev[itemId] || EMPTY_ITEM_INTERACTION_STATE;
      const next: ItemInteractionState = { ...current, [key]: value };
      if (!next.reacting && !next.saving && !next.commenting && !next.following && !next.deleting) {
        const rest = { ...prev };
        delete rest[itemId];
        return rest;
      }
      return { ...prev, [itemId]: next };
    });
  }, []);

  const setAuthorInteractionPending = useCallback((authorId: string, value: boolean) => {
    const itemIds = itemsRef.current.filter((item) => item.author?.id === authorId).map((item) => item.id);
    if (itemIds.length === 0) return;
    setPendingInteractions((prev) => {
      const next = { ...prev };
      itemIds.forEach((itemId) => {
        const current = next[itemId] || EMPTY_ITEM_INTERACTION_STATE;
        const updated: ItemInteractionState = { ...current, following: value };
        if (!updated.reacting && !updated.saving && !updated.commenting && !updated.following && !updated.deleting) {
          delete next[itemId];
          return;
        }
        next[itemId] = updated;
      });
      return next;
    });
  }, []);

  const handleCommentDeleted = useCallback(
    (itemId: string, commentCount: number) => {
      updateItem(itemId, (item) => ({
        ...item,
        metrics: { ...item.metrics, comments: Math.max(0, commentCount) },
      }));
    },
    [updateItem]
  );

  const handleReact = useCallback(
    async (itemId: string, reaction: ReactionType) => {
      if (reactingItemsRef.current.has(itemId)) return;
      const existingItem = itemsRef.current.find((item) => item.id === itemId);

      reactingItemsRef.current.add(itemId);
      if (existingItem) {
        setInteractionPending(itemId, 'reacting', true);
        const previousReaction = existingItem.userInteraction.reaction;
        const previousCount = existingItem.metrics.reactions;
        const optimisticReaction = previousReaction === reaction ? undefined : reaction;
        const optimisticDelta = previousReaction ? (optimisticReaction ? 0 : -1) : 1;

        updateItem(itemId, (item) => ({
          ...item,
          metrics: { ...item.metrics, reactions: Math.max(0, previousCount + optimisticDelta) },
          userInteraction: { ...item.userInteraction, reaction: optimisticReaction },
        }));
      }

      try {
        const response = await socialFeedService.reactToItem(itemId, reaction);
        if (existingItem) {
          updateItem(itemId, (item) => ({
            ...item,
            metrics: { ...item.metrics, reactions: Math.max(0, response.reaction_count) },
            userInteraction: { ...item.userInteraction, reaction: response.reaction },
          }));
        }
        await options.onSidebarRefresh?.();
      } catch (error) {
        if (existingItem) {
          const previousReaction = existingItem.userInteraction.reaction;
          const previousCount = existingItem.metrics.reactions;
          updateItem(itemId, (item) => ({
            ...item,
            metrics: { ...item.metrics, reactions: Math.max(0, previousCount) },
            userInteraction: { ...item.userInteraction, reaction: previousReaction },
          }));
        }
        message.error(errorMessage(error, t('unable_update_reaction')));
      } finally {
        reactingItemsRef.current.delete(itemId);
        if (existingItem) {
          setInteractionPending(itemId, 'reacting', false);
        }
      }
    },
    [options, setInteractionPending, t, updateItem]
  );

  const handleSave = useCallback(
    async (itemId: string) => {
      if (savingItemsRef.current.has(itemId)) return;
      const existingItem = itemsRef.current.find((item) => item.id === itemId);
      savingItemsRef.current.add(itemId);
      if (existingItem) {
        setInteractionPending(itemId, 'saving', true);
        const previousBookmarked = existingItem.userInteraction.isBookmarked;
        const previousCount = existingItem.metrics.bookmarks;
        const optimisticBookmarked = !previousBookmarked;
        const optimisticCount = Math.max(0, previousCount + (optimisticBookmarked ? 1 : -1));

        updateItem(itemId, (item) => ({
          ...item,
          metrics: { ...item.metrics, bookmarks: optimisticCount },
          userInteraction: { ...item.userInteraction, isBookmarked: optimisticBookmarked },
        }));
      }

      try {
        const response = await socialFeedService.toggleBookmark(itemId);
        if (existingItem) {
          updateItem(itemId, (item) => ({
            ...item,
            metrics: { ...item.metrics, bookmarks: Math.max(0, response.bookmark_count) },
            userInteraction: { ...item.userInteraction, isBookmarked: response.isBookmarked },
          }));
        }
        await options.onSidebarRefresh?.();

        if (response.isBookmarked) {
          message.success(t('saved_for_review'));
        } else {
          message.info(t('removed_from_saved'));
        }
      } catch (error) {
        if (existingItem) {
          const previousBookmarked = existingItem.userInteraction.isBookmarked;
          const previousCount = existingItem.metrics.bookmarks;
          updateItem(itemId, (item) => ({
            ...item,
            metrics: { ...item.metrics, bookmarks: Math.max(0, previousCount) },
            userInteraction: { ...item.userInteraction, isBookmarked: previousBookmarked },
          }));
        }
        message.error(errorMessage(error, t('unable_update_saved')));
      } finally {
        savingItemsRef.current.delete(itemId);
        if (existingItem) {
          setInteractionPending(itemId, 'saving', false);
        }
      }
    },
    [options, setInteractionPending, t, updateItem]
  );

  const handleAddComment = useCallback(
    async (itemId: string, content: string, parentCommentId?: string) => {
      if (commentingItemsRef.current.has(itemId)) return;
      const existingItem = itemsRef.current.find((item) => item.id === itemId);
      if (!existingItem) return;

      commentingItemsRef.current.add(itemId);
      setInteractionPending(itemId, 'commenting', true);

      const previousCount = existingItem.metrics.comments;
      const previousLastActivity = existingItem.lastActivityAt;
      const previousRecentComments = existingItem.recentComments;
      const optimisticTimestamp = new Date().toISOString();

      updateItem(itemId, (item) => ({
        ...item,
        lastActivityAt: optimisticTimestamp,
        metrics: { ...item.metrics, comments: Math.max(0, previousCount + 1) },
      }));

      try {
        const response = await socialFeedService.addComment(itemId, content, parentCommentId);
        updateItem(itemId, (item) => ({
          ...item,
          lastActivityAt: response.comment.createdAt,
          metrics: { ...item.metrics, comments: Math.max(0, response.comment_count) },
          recentComments: upsertCommentInThread(item.recentComments, response.comment),
        }));
      } catch (error) {
        updateItem(itemId, (item) => ({
          ...item,
          lastActivityAt: previousLastActivity,
          metrics: { ...item.metrics, comments: Math.max(0, previousCount) },
          recentComments: previousRecentComments,
        }));
        message.error(errorMessage(error, t('unable_add_comment')));
      } finally {
        commentingItemsRef.current.delete(itemId);
        setInteractionPending(itemId, 'commenting', false);
      }
    },
    [setInteractionPending, t, updateItem]
  );

  const handleToggleFollow = useCallback(
    async (itemId: string, authorId: string) => {
      if (followingAuthorsRef.current.has(authorId)) return;
      const targetItem = itemsRef.current.find((item) => item.id === itemId);
      if (!targetItem) return;

      const previousFollowState = new Map<string, boolean>();
      itemsRef.current.forEach((item) => {
        if (item.author?.id === authorId) {
          previousFollowState.set(item.id, Boolean(item.userInteraction?.isFollowingAuthor));
        }
      });
      if (previousFollowState.size === 0) return;

      followingAuthorsRef.current.add(authorId);
      setAuthorInteractionPending(authorId, true);

      const optimisticFollowing = !Boolean(targetItem.userInteraction?.isFollowingAuthor);
      updateItemsByAuthor(authorId, (item) => ({
        ...item,
        userInteraction: { ...item.userInteraction, isFollowingAuthor: optimisticFollowing },
      }));

      try {
        const response = await socialFeedService.toggleFollowAuthor(authorId);
        updateItemsByAuthor(authorId, (item) => ({
          ...item,
          userInteraction: { ...item.userInteraction, isFollowingAuthor: response.isFollowing },
        }));
        message.success(response.isFollowing ? t('following_author') : t('unfollowed_author'));
      } catch (error) {
        setItems((prev) => {
          const restored = prev.map((item) => {
            if (item.author?.id !== authorId) return item;
            return {
              ...item,
              userInteraction: {
                ...item.userInteraction,
                isFollowingAuthor: previousFollowState.get(item.id) || false,
              },
            };
          });
          itemsRef.current = restored;
          return restored;
        });
        message.error(errorMessage(error, t('unable_update_follow')));
      } finally {
        followingAuthorsRef.current.delete(authorId);
        setAuthorInteractionPending(authorId, false);
      }
    },
    [setAuthorInteractionPending, setItems, t, updateItemsByAuthor]
  );

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (deletingItemsRef.current.has(itemId)) return;
      if (!itemsRef.current.some((item) => item.id === itemId)) return;

      deletingItemsRef.current.add(itemId);
      setInteractionPending(itemId, 'deleting', true);

      const previousItems = itemsRef.current;
      const nextItems = previousItems.filter((item) => item.id !== itemId);
      itemsRef.current = nextItems;
      setItems(nextItems);

      try {
        await socialFeedService.deleteItem(itemId);
        message.success(t('post_deleted'));
      } catch (error) {
        itemsRef.current = previousItems;
        setItems(previousItems);
        message.error(errorMessage(error, t('unable_delete_post')));
      } finally {
        deletingItemsRef.current.delete(itemId);
        setInteractionPending(itemId, 'deleting', false);
      }
    },
    [setInteractionPending, setItems, t]
  );

  return {
    pendingInteractions,
    handleReact,
    handleSave,
    handleAddComment,
    handleToggleFollow,
    handleDeleteItem,
    handleCommentDeleted,
    updateItem,
  };
}

/** Single-item adapter for detail pages */
export function useFeedItemInteractions(
  item: FeedItem | null,
  setItem: React.Dispatch<React.SetStateAction<FeedItem | null>>,
  options: UseFeedInteractionsOptions = {}
) {
  const items = item ? [item] : [];
  const setItems: React.Dispatch<React.SetStateAction<FeedItem[]>> = useCallback(
    (updater) => {
      setItem((prev) => {
        if (!prev) return prev;
        const current = [prev];
        const next = typeof updater === 'function' ? updater(current) : updater;
        return next[0] ?? null;
      });
    },
    [setItem]
  ) as React.Dispatch<React.SetStateAction<FeedItem[]>>;

  return useFeedInteractions(items, setItems, options);
}
