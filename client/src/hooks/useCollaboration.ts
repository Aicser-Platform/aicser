import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { debounce, throttle } from 'lodash';
import { useDashboardStore } from '@/app/(dashboard)/dashboards/stores/useDashboardStore';
import type { LayoutItem, WidgetInstance } from '@/app/(dashboard)/dashboards/stores/dashboardStoreTypes';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import {
  computeCollabChanges,
  computeLayoutChanged,
  peerCountFromActiveUsers,
  stampCollabTs,
} from '@/app/(dashboard)/dashboards/utils/collaborationSync';
import type { CollabComment, CollabUser, PeerCursor } from '@/app/(dashboard)/dashboards/utils/collaborationTypes';

type RemoteUpdate =
  | { type: 'widget:update'; id: string; changes: Partial<WidgetInstance>; collabTs: number }
  | { type: 'widget:add'; widget: WidgetInstance; layout?: LayoutItem }
  | { type: 'widget:remove'; id: string }
  | { type: 'layout:update'; layout: LayoutItem[]; layoutTs: number };

const CURSOR_STALE_MS = 8000;

function displayName(user?: CollabUser | null): string {
  return user?.username || user?.name || user?.email || 'Editor';
}

function userKey(user?: CollabUser | null): string {
  return String(user?.user_id || user?.id || '');
}

/**
 * Real-time multi-editor sync for dashboard studio (EE Socket.IO).
 */
export function useCollaboration(dashboardId: string) {
  const socketRef = useRef<Socket | null>(null);
  const prevWidgetsRef = useRef<WidgetInstance[]>([]);
  const prevLayoutRef = useRef<LayoutItem[]>([]);
  const layoutTsRef = useRef(0);
  const applyingRemoteRef = useRef(false);
  const emitWidgetEditingRef = useRef<(widgetId: string | null) => void>(() => {});
  const emitCursorMoveRef = useRef<(x: number, y: number, widgetId?: string | null) => void>(() => {});

  const { user, session } = useAuth();
  const applyRemoteUpdate = useDashboardStore((s) => s.applyRemoteUpdate);
  const [connected, setConnected] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [activeUsers, setActiveUsers] = useState<CollabUser[]>([]);
  const [peerEditingWidgetId, setPeerEditingWidgetId] = useState<string | null>(null);
  const [peerCursors, setPeerCursors] = useState<PeerCursor[]>([]);
  const [comments, setComments] = useState<CollabComment[]>([]);

  const selfUserId = user?.id ?? null;

  const applyRemote = useCallback(
    (update: RemoteUpdate) => {
      applyingRemoteRef.current = true;
      applyRemoteUpdate(update);
      queueMicrotask(() => {
        const state = useDashboardStore.getState();
        prevWidgetsRef.current = state.widgets;
        prevLayoutRef.current = state.layout;
        if (update.type === 'layout:update') {
          layoutTsRef.current = update.layoutTs;
        }
        applyingRemoteRef.current = false;
      });
    },
    [applyRemoteUpdate],
  );

  const addComment = useCallback(
    (text: string, widgetId?: string | null) => {
      const socket = socketRef.current;
      if (!socket || !dashboardId || !text.trim()) return;
      const optimistic: CollabComment = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: text.trim(),
        widget_id: widgetId ?? null,
        user: {
          id: user?.id,
          user_id: user?.id,
          username: (user?.user_metadata as { username?: string })?.username || user?.email || undefined,
          email: user?.email || undefined,
        },
        timestamp: new Date().toISOString(),
      };
      setComments((prev) => [...prev, optimistic]);
      socket.emit('comment:add', {
        dashboard_id: dashboardId,
        text: text.trim(),
        widget_id: widgetId ?? null,
      });
    },
    [dashboardId, user],
  );

  useEffect(() => {
    if (!dashboardId) {
      setConnected(false);
      setPeerCount(0);
      setActiveUsers([]);
      setPeerCursors([]);
      setComments([]);
      setPeerEditingWidgetId(null);
      return;
    }

    const accessToken = session?.access_token;
    if (!accessToken) {
      setConnected(false);
      setPeerCount(0);
      return;
    }

    const socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      query: { token: accessToken },
      autoConnect: true,
      reconnection: true,
    });

    socketRef.current = socket;

    const syncPeers = (users?: CollabUser[]) => {
      setActiveUsers(users ?? []);
      setPeerCount(peerCountFromActiveUsers(users, selfUserId));
    };

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.emit('join_dashboard', {
      dashboard_id: dashboardId,
      user: {
        id: user?.id,
        user_id: user?.id,
        name: (user?.user_metadata as { username?: string })?.username || user?.email,
        email: user?.email,
      },
    });

    socket.on('dashboard:state', (data: { active_users?: CollabUser[] }) => {
      syncPeers(data.active_users);
    });

    socket.on('widget:update', (data: { widget_id: string; changes: Partial<WidgetInstance>; collab_ts?: number }) => {
      if (!data?.widget_id || !data.changes) return;
      const collabTs = data.collab_ts ?? (data.changes.collabTs as number | undefined) ?? stampCollabTs();
      applyRemote({ type: 'widget:update', id: data.widget_id, changes: data.changes, collabTs });
    });

    socket.on('widget:add', (data: { widget: WidgetInstance; layout?: LayoutItem }) => {
      if (!data?.widget) return;
      applyRemote({ type: 'widget:add', widget: data.widget, layout: data.layout });
    });

    socket.on('widget:remove', (data: { widget_id: string }) => {
      if (!data?.widget_id) return;
      applyRemote({ type: 'widget:remove', id: data.widget_id });
    });

    socket.on('layout:update', (data: { layout: LayoutItem[]; layout_ts?: number }) => {
      if (!Array.isArray(data?.layout)) return;
      const layoutTs = data.layout_ts ?? stampCollabTs();
      applyRemote({ type: 'layout:update', layout: data.layout, layoutTs });
    });

    socket.on('user:joined', (data: { active_users?: CollabUser[] }) => syncPeers(data.active_users));
    socket.on('user:left', (data: { active_users?: CollabUser[] }) => syncPeers(data.active_users));

    socket.on('widget:editing', (data: { widget_id?: string | null; user?: CollabUser }) => {
      const remoteId = userKey(data.user);
      if (remoteId && remoteId === selfUserId) return;
      setPeerEditingWidgetId(data.widget_id ? String(data.widget_id) : null);
    });

    socket.on('cursor:move', (data: { user?: CollabUser; x?: number; y?: number; widget_id?: string | null }) => {
      const uid = userKey(data.user);
      if (!uid || uid === selfUserId) return;
      const x = typeof data.x === 'number' ? data.x : 0;
      const y = typeof data.y === 'number' ? data.y : 0;
      setPeerCursors((prev) => {
        const next = prev.filter((c) => c.userId !== uid);
        next.push({
          userId: uid,
          name: displayName(data.user),
          color: data.user?.color || '#00c2cb',
          x,
          y,
          widgetId: data.widget_id ?? null,
          updatedAt: Date.now(),
        });
        return next;
      });
    });

    socket.on('comment:add', (comment: CollabComment) => {
      if (!comment?.id) return;
      setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]));
    });

    emitWidgetEditingRef.current = (widgetId: string | null) => {
      socket.emit('widget:editing', {
        dashboard_id: dashboardId,
        widget_id: widgetId,
        user: {
          id: user?.id,
          user_id: user?.id,
          name: (user?.user_metadata as { username?: string })?.username || user?.email,
        },
      });
    };

    emitCursorMoveRef.current = throttle((x: number, y: number, widgetId?: string | null) => {
      socket.emit('cursor:move', {
        dashboard_id: dashboardId,
        x,
        y,
        widget_id: widgetId ?? null,
      });
    }, 48);

    const bumpLocalWidgetTs = (widgetId: string, collabTs: number, changes: Partial<WidgetInstance>) => {
      applyingRemoteRef.current = true;
      useDashboardStore.setState((state) => {
        const widgets = state.widgets.map((w) =>
          w.id === widgetId ? { ...w, ...changes, collabTs } : w,
        );
        const dashboards = state.dashboards.map((d) =>
          d.id === state.activeDashboardId ? { ...d, widgets } : d,
        );
        return { widgets, dashboards };
      });
      queueMicrotask(() => {
        prevWidgetsRef.current = useDashboardStore.getState().widgets;
        applyingRemoteRef.current = false;
      });
    };

    const emitWidgetChanges = debounce((widgets: WidgetInstance[], layout: LayoutItem[]) => {
      if (applyingRemoteRef.current) return;

      const changes = computeCollabChanges(prevWidgetsRef.current, widgets, layout);

      changes.forEach((change) => {
        switch (change.type) {
          case 'update': {
            const payload = { ...change.changes, collabTs: change.collabTs };
            bumpLocalWidgetTs(change.id, change.collabTs, payload);
            socket.emit('widget:update', {
              dashboard_id: dashboardId,
              widget_id: change.id,
              changes: payload,
              collab_ts: change.collabTs,
            });
            break;
          }
          case 'add':
            socket.emit('widget:add', {
              dashboard_id: dashboardId,
              widget: change.widget,
              layout: change.layout,
            });
            break;
          case 'remove':
            socket.emit('widget:remove', {
              dashboard_id: dashboardId,
              widget_id: change.id,
              widget: change.widget,
            });
            break;
        }
      });

      prevWidgetsRef.current = widgets;

      if (computeLayoutChanged(prevLayoutRef.current, layout)) {
        const layoutTs = stampCollabTs();
        layoutTsRef.current = layoutTs;
        prevLayoutRef.current = layout;
        applyingRemoteRef.current = true;
        useDashboardStore.setState({ layoutCollabTs: layoutTs });
        queueMicrotask(() => {
          applyingRemoteRef.current = false;
        });
        socket.emit('layout:update', {
          dashboard_id: dashboardId,
          layout,
          layout_ts: layoutTs,
        });
      }
    }, 300);

    const initial = useDashboardStore.getState();
    prevWidgetsRef.current = initial.widgets;
    prevLayoutRef.current = initial.layout;
    let observedWidgets = initial.widgets;
    let observedLayout = initial.layout;

    const unsubscribe = useDashboardStore.subscribe((state) => {
      if (state.widgets === observedWidgets && state.layout === observedLayout) return;
      observedWidgets = state.widgets;
      observedLayout = state.layout;
      emitWidgetChanges(state.widgets, state.layout);
    });

    const cursorPrune = window.setInterval(() => {
      const cutoff = Date.now() - CURSOR_STALE_MS;
      setPeerCursors((prev) => prev.filter((c) => c.updatedAt >= cutoff));
    }, 2000);

    return () => {
      window.clearInterval(cursorPrune);
      socket.emit('leave_dashboard', { dashboard_id: dashboardId });
      socket.disconnect();
      unsubscribe();
      emitWidgetChanges.cancel();
      emitCursorMoveRef.current = () => {};
      emitWidgetEditingRef.current = () => {};
      socketRef.current = null;
      setConnected(false);
      setPeerCount(0);
      setActiveUsers([]);
      setPeerCursors([]);
      setComments([]);
      setPeerEditingWidgetId(null);
    };
  }, [dashboardId, user, session?.access_token, selfUserId, applyRemote]);

  return {
    connected,
    peerCount,
    activeUsers,
    peerCursors,
    comments,
    addComment,
    emitCursorMove: (x: number, y: number, widgetId?: string | null) =>
      emitCursorMoveRef.current(x, y, widgetId),
    emitWidgetEditing: (widgetId: string | null) => emitWidgetEditingRef.current(widgetId),
    peerEditingWidgetId,
    selfUserId,
  };
}
