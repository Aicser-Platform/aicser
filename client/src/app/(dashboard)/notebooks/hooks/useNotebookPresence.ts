'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/useAuthStore';
import { getCeBearerToken } from '@/auth/ce/bearerToken';

export type NotebookPeer = { user_id: string; username?: string; color?: string; cell_id?: string | null };

/**
 * Live presence for notebooks (who is viewing, which cell is focused). EE Socket.IO.
 */
export function useNotebookPresence(notebookId: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const { session, user } = useAuthStore();
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<NotebookPeer[]>([]);

  const emitFocus = useCallback((cellId: string | null) => {
    if (!notebookId || !socketRef.current?.connected) return;
    socketRef.current.emit('notebook:cell_focus', { notebook_id: notebookId, cell_id: cellId });
  }, [notebookId]);

  useEffect(() => {
    const token = session?.access_token || getCeBearerToken();
    if (!notebookId || !token) {
      setConnected(false);
      setPeers([]);
      return;
    }
    const socket = io(typeof window !== 'undefined' ? window.location.origin : '', {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_notebook', {
        notebook_id: notebookId,
        user: { name: user?.email || user?.username },
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('notebook:presence', (payload: { active_users?: NotebookPeer[] }) => {
      setPeers(payload.active_users ?? []);
    });
    socket.on('notebook:cell_focus', (payload: { user_id: string; cell_id?: string | null }) => {
      setPeers((prev) => prev.map((p) => (p.user_id === payload.user_id ? { ...p, cell_id: payload.cell_id ?? null } : p)));
    });
    return () => {
      socket.emit('leave_notebook', { notebook_id: notebookId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [notebookId, session?.access_token, user?.email, user?.username]);

  return { connected, peers, emitFocus };
}
