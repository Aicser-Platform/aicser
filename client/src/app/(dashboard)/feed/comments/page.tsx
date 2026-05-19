'use client';
export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import FeedCard from '../components/FeedCard';
import FeedCardSkeleton from '../components/FeedCardSkeleton';
import { socialFeedService } from '@/services/socialFeedService';
import type { FeedItem, ReactionType } from '@/services/socialFeedService';
import { useTranslations } from 'next-intl';
import '../styles.css';

const COMMENTED_FETCH_PAGE_SIZE = 100;
const COMMENTED_FETCH_MAX_ITEMS = 200;

type ItemInteractionKey = 'reacting' | 'saving' | 'commenting' | 'following' | 'deleting';
type ItemInteractionState = Record<ItemInteractionKey, boolean>;
const EMPTY_ITEM_INTERACTION_STATE: ItemInteractionState = {
  reacting: false,
  saving: false,
  commenting: false,
  following: false,
  deleting: false,
};
const COMMENTED_SKELETON_COUNT = 4;

const upsertCommentInThread = (comments: FeedItem['recentComments'], comment: FeedItem['recentComments'][number]) => {
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

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const CommentedFeedPage: React.FC = () => {
  const t = useTranslations('feed_page');
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingInteractions, setPendingInteractions] = useState<Record<string, ItemInteractionState>>({});
  const itemsRef = useRef<FeedItem[]>([]);
  const followingAuthorsRef = useRef<Set<string>>(new Set());
  const deletingItemsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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

  const loadCommentedItems = useCallback(async () => {
    setLoading(true);
    try {
      const collected: FeedItem[] = [];
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;

      while (offset < total && collected.length < COMMENTED_FETCH_MAX_ITEMS) {
        const limit = Math.min(COMMENTED_FETCH_PAGE_SIZE, COMMENTED_FETCH_MAX_ITEMS - collected.length);
        const response = await socialFeedService.getCommentedFeed({ sort: 'recent', limit, offset });
        const pageItems = response.items ?? [];
        collected.push(...pageItems);
        total = response.total;
        offset += pageItems.length;

        if (pageItems.length === 0) break;
      }

      setItems(collected);
      itemsRef.current = collected;
    } catch (error) {
      message.error(errorMessage(error, 'Failed to load commented items'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCommentedItems();
  }, [loadCommentedItems]);

  const updateItem = (itemId: string, updater: (item: FeedItem) => FeedItem) => {
    setItems((prev) => {
      const next = prev.map((item) => (item.id === itemId ? updater(item) : item));
      itemsRef.current = next;
      return next;
    });
  };
  const updateItemsByAuthor = useCallback((authorId: string, updater: (item: FeedItem) => FeedItem) => {
    setItems((prev) => {
      const next = prev.map((item) => (item.author?.id === authorId ? updater(item) : item));
      itemsRef.current = next;
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

  const handleReact = async (itemId: string, reaction: ReactionType) => {
    const existingItem = items.find((item) => item.id === itemId);
    if (!existingItem || pendingInteractions[itemId]?.reacting) return;

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

    try {
      const response = await socialFeedService.reactToItem(itemId, reaction);
      updateItem(itemId, (item) => ({
        ...item,
        metrics: { ...item.metrics, reactions: Math.max(0, response.reaction_count) },
        userInteraction: { ...item.userInteraction, reaction: response.reaction },
      }));
    } catch (error) {
      updateItem(itemId, (item) => ({
        ...item,
        metrics: { ...item.metrics, reactions: Math.max(0, previousCount) },
        userInteraction: { ...item.userInteraction, reaction: previousReaction },
      }));
      message.error(errorMessage(error, 'Unable to update reaction'));
    } finally {
      setInteractionPending(itemId, 'reacting', false);
    }
  };

  const handleSave = async (itemId: string) => {
    const existingItem = items.find((item) => item.id === itemId);
    if (!existingItem || pendingInteractions[itemId]?.saving) return;

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

    try {
      const response = await socialFeedService.toggleBookmark(itemId);
      if (response.isBookmarked) {
        message.success('Saved for review');
      } else {
        message.info('Removed from saved items');
      }
      await loadCommentedItems();
    } catch (error) {
      updateItem(itemId, (item) => ({
        ...item,
        metrics: { ...item.metrics, bookmarks: Math.max(0, previousCount) },
        userInteraction: { ...item.userInteraction, isBookmarked: previousBookmarked },
      }));
      message.error(errorMessage(error, 'Unable to update saved state'));
    } finally {
      setInteractionPending(itemId, 'saving', false);
    }
  };

  const handleAddComment = async (itemId: string, content: string, parentCommentId?: string) => {
    const existingItem = items.find((item) => item.id === itemId);
    if (!existingItem || pendingInteractions[itemId]?.commenting) return;

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
      message.error(errorMessage(error, 'Unable to add comment'));
    } finally {
      setInteractionPending(itemId, 'commenting', false);
    }
  };
  const handleToggleFollow = async (itemId: string, authorId: string) => {
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
  };
  const handleDeleteItem = async (itemId: string) => {
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
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => router.push('/feed')}
            className="flex items-center rounded-md text-sm font-medium border-[var(--ant-color-border)] text-[var(--ant-color-text)] hover:text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-layout)] h-9 px-4 transition-colors"
          >
            {t('back_to_feed')}
          </Button>
          <h1 className="text-2xl font-bold text-[var(--ant-color-text)] tracking-tight">{t('commented_items_title')}</h1>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {loading && (
          <div className="flex flex-col gap-6">
            {Array.from({ length: COMMENTED_SKELETON_COUNT }).map((_, index) => (
              <FeedCardSkeleton key={`commented-skeleton-${index}`} compact />
            ))}
          </div>
        )}

        {!loading && items.length === 0 && (
          <Empty
            description={t('commented_empty')}
            className="my-12 py-12 bg-[var(--ant-color-bg-container)] rounded-xl border border-[var(--ant-color-border-secondary)] shadow-sm"
          />
        )}

        {!loading && items.length > 0 && (
          <div className="flex flex-col gap-6">
            {items.map((item) => (
              <FeedCard
                key={item.id}
                item={item}
                onReact={handleReact}
                onSave={handleSave}
                onAddComment={handleAddComment}
                onToggleFollow={handleToggleFollow}
                onDeleteItem={handleDeleteItem}
                onCommentDeleted={handleCommentDeleted}
                interactionState={pendingInteractions[item.id]}
                compact
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CommentedFeedPage;
