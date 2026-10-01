import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchApi } from '@/utils/api';
import {
  DASHBOARD_COMMENT_EVENT,
  type DashboardComment,
  type DashboardCommentEvent,
  type DashboardCommentThread,
} from '../utils/collaborationTypes';

/** Comments live under a resource: dashboards by default; notebooks reuse the same API shape. */
const base = (dashboardId: string, root = 'dashboards') => `${root}/${encodeURIComponent(dashboardId)}/comments`;

export const dashboardCommentsService = {
  async list(dashboardId: string, root?: string): Promise<DashboardCommentThread[]> {
    const data = await fetchApi<{ threads?: DashboardCommentThread[] }>(base(dashboardId, root), { method: 'GET' });
    return Array.isArray(data?.threads) ? data.threads : [];
  },
  create(dashboardId: string, body: string, opts: { widgetId?: string | null; parentId?: string | null } = {}, root?: string) {
    return fetchApi<DashboardComment>(base(dashboardId, root), {
      method: 'POST',
      body: JSON.stringify({ body, widget_id: opts.widgetId ?? null, parent_id: opts.parentId ?? null }),
    });
  },
  update(dashboardId: string, commentId: string, patch: { body?: string; resolved?: boolean }, root?: string) {
    return fetchApi<DashboardComment>(`${base(dashboardId, root)}/${encodeURIComponent(commentId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },
  remove(dashboardId: string, commentId: string, root?: string) {
    return fetchApi<{ id: string; parent_id: string | null; deleted: true }>(
      `${base(dashboardId, root)}/${encodeURIComponent(commentId)}`,
      { method: 'DELETE' },
    );
  },
};

/** Apply one saved-comment change (from our own request or the live socket) to the thread list. */
export function mergeCommentEvent(
  threads: DashboardCommentThread[],
  event: DashboardCommentEvent['event'],
  comment: Partial<DashboardComment> & { id: string },
): DashboardCommentThread[] {
  const parentId = comment.parent_id ?? null;
  if (event === 'comment:deleted') {
    if (parentId) {
      return threads.map((t) =>
        t.id === parentId ? { ...t, replies: t.replies.filter((r) => r.id !== comment.id) } : t,
      );
    }
    return threads.flatMap((t) => {
      if (t.id !== comment.id) return [t];
      // A deleted thread with replies stays as a placeholder so the replies keep their context.
      return t.replies.length ? [{ ...t, deleted: true, body: '' }] : [];
    });
  }
  const full = comment as DashboardComment;
  if (parentId) {
    return threads.map((t) => {
      if (t.id !== parentId) return t;
      const exists = t.replies.some((r) => r.id === full.id);
      return {
        ...t,
        replies: exists ? t.replies.map((r) => (r.id === full.id ? { ...r, ...full } : r)) : [...t.replies, full],
      };
    });
  }
  if (threads.some((t) => t.id === full.id)) {
    return threads.map((t) => (t.id === full.id ? { ...t, ...full, replies: t.replies } : t));
  }
  return event === 'comment:created' ? [...threads, { ...full, replies: [] }] : threads;
}

/**
 * Saved dashboard comments: loaded over the API (so they work in view mode and without the
 * live socket), changed through it, and kept current by live socket events when connected.
 */
export function useDashboardComments(dashboardId: string | null | undefined, enabled = true, root?: string) {
  const [threads, setThreads] = useState<DashboardCommentThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!dashboardId) return;
    setLoading(true);
    try {
      setThreads(await dashboardCommentsService.list(dashboardId, root));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dashboardId, root]);

  useEffect(() => {
    setThreads([]);
    setError(null);
    if (dashboardId && enabled) void reload();
  }, [dashboardId, enabled, reload]);

  useEffect(() => {
    if (!dashboardId || typeof window === 'undefined') return;
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<DashboardCommentEvent>).detail;
      if (!detail || detail.dashboardId !== dashboardId || !detail.comment?.id) return;
      setThreads((prev) => mergeCommentEvent(prev, detail.event, detail.comment));
    };
    window.addEventListener(DASHBOARD_COMMENT_EVENT, onEvent);
    return () => window.removeEventListener(DASHBOARD_COMMENT_EVENT, onEvent);
  }, [dashboardId]);

  const add = useCallback(
    async (body: string, opts: { widgetId?: string | null; parentId?: string | null } = {}) => {
      if (!dashboardId) return null;
      const saved = await dashboardCommentsService.create(dashboardId, body, opts, root);
      setThreads((prev) => {
        let next = mergeCommentEvent(prev, 'comment:created', saved);
        // Replying reopens a resolved thread (the server does the same).
        if (saved.parent_id) {
          next = next.map((t) => (t.id === saved.parent_id ? { ...t, resolved_at: null, resolved_by: null } : t));
        }
        return next;
      });
      return saved;
    },
    [dashboardId, root],
  );

  const edit = useCallback(
    async (commentId: string, body: string) => {
      if (!dashboardId) return;
      const saved = await dashboardCommentsService.update(dashboardId, commentId, { body }, root);
      setThreads((prev) => mergeCommentEvent(prev, 'comment:updated', saved));
    },
    [dashboardId, root],
  );

  const setResolved = useCallback(
    async (commentId: string, resolved: boolean) => {
      if (!dashboardId) return;
      const saved = await dashboardCommentsService.update(dashboardId, commentId, { resolved }, root);
      setThreads((prev) => mergeCommentEvent(prev, 'comment:updated', saved));
    },
    [dashboardId, root],
  );

  const remove = useCallback(
    async (commentId: string) => {
      if (!dashboardId) return;
      const out = await dashboardCommentsService.remove(dashboardId, commentId, root);
      setThreads((prev) => mergeCommentEvent(prev, 'comment:deleted', out));
    },
    [dashboardId, root],
  );

  const openCount = useMemo(() => threads.filter((t) => !t.resolved_at && !t.deleted).length, [threads]);

  return { threads, loading, error, openCount, reload, add, edit, setResolved, remove };
}
