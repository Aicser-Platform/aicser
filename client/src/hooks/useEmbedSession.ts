'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { EmbedTheme } from './useEmbedCode';
import { notifyEmbedError, parseEmbedErrorDetail, postEmbedMessage } from '@/utils/embedMessaging';
import { embeddingOrigin, originAllowed, setLatestEmbedToken } from '@/utils/embedSession';

export type EmbedDownload = 'none' | 'image' | 'data';
export type EmbedSessionScope = 'dashboard' | 'chart' | 'chat' | 'report';

type OpenedSession = {
  token: string;
  expires_at?: string | null;
  download?: EmbedDownload;
  theme?: EmbedTheme | null;
  single_use?: boolean;
  allowed_origins?: string[];
};

export type EmbedSessionState = {
  /** `opening` until the link is exchanged; `expired` once the session ran out unrenewed. */
  status: 'opening' | 'ready' | 'error' | 'expired';
  /** The first session's token: stable for the page's lifetime. Requests resolve the newest
   *  one through resolveEmbedToken, so a renewal doesn't reload the view. '' without a link. */
  token: string;
  download: EmbedDownload;
  theme: EmbedTheme | null;
  error: string | null;
  /** Sites allowed to show this embed and send it commands ([] = any). */
  allowedOrigins: string[];
};

// One exchange per link, even when React runs an effect twice: a single-use link can't be
// opened a second time.
const openings = new Map<string, Promise<OpenedSession>>();

function openSession(linkToken: string, scope: EmbedSessionScope): Promise<OpenedSession> {
  const existing = openings.get(linkToken);
  if (existing) return existing;
  const opening = (async () => {
    const res = await fetch('/api/embed/session', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: linkToken, parent_origin: embeddingOrigin() || undefined, scope }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parseEmbedErrorDetail(body, `Embed could not open (${res.status})`));
    return body as OpenedSession;
  })();
  opening.catch(() => openings.delete(linkToken));
  openings.set(linkToken, opening);
  return opening;
}

/** setTimeout fires at once for delays past ~24.8 days; long public links just don't schedule. */
const MAX_TIMER_MS = 2_147_000_000;

/** A message the page showing this embed sent to it, if it came from that page and it's allowed. */
export function hostMessage(
  event: MessageEvent,
  allowedOrigins: string[],
): { type: string; payload?: unknown } | null {
  if (typeof window === 'undefined' || event.source !== window.parent || window.parent === window) return null;
  const data = event.data as { source?: string; type?: unknown; payload?: unknown } | null;
  if (!data || data.source !== 'aicser-host' || typeof data.type !== 'string') return null;
  if (allowedOrigins.length && !originAllowed(event.origin, allowedOrigins)) return null;
  return { type: data.type, payload: data.payload };
}

/**
 * Opens the embed's session from the link token in the URL, the way Looker and Tableau do:
 * the link is exchanged once for a session kept in memory, a single-use link is removed from
 * the address bar, and before the session runs out the host page is asked for a fresh token
 * (the SDK's getToken) so the view carries on without a reload.
 */
export function useEmbedSession(scope: EmbedSessionScope): EmbedSessionState {
  const searchParams = useSearchParams();
  // Read once: a single-use link is removed from the URL after it opens.
  const [linkToken] = useState<string>(() => searchParams?.get('token') || '');
  const [state, setState] = useState<EmbedSessionState>({
    status: linkToken ? 'opening' : 'ready',
    token: '',
    download: 'none',
    theme: null,
    error: null,
    allowedOrigins: [],
  });
  const timers = useRef<number[]>([]);
  const allowedRef = useRef<string[]>([]);

  const schedule = useCallback((expiresAt?: string | null) => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    const end = expiresAt ? Date.parse(expiresAt) : NaN;
    if (!Number.isFinite(end)) return;
    const left = end - Date.now();
    if (left > MAX_TIMER_MS) return;
    // Ask two minutes ahead (or halfway, for short sessions) so the host has time to answer.
    const warnIn = Math.max(0, left - Math.min(120_000, left / 2));
    timers.current.push(
      window.setTimeout(() => postEmbedMessage('token-expiring', { expiresAt }), warnIn),
      window.setTimeout(() => {
        setState((s) => ({ ...s, status: 'expired' }));
        postEmbedMessage('token-expired', { expiresAt });
      }, Math.max(0, left)),
    );
  }, []);

  const apply = useCallback(
    (opened: OpenedSession) => {
      setLatestEmbedToken(opened.token);
      allowedRef.current = opened.allowed_origins || [];
      setState((s) => ({
        status: 'ready',
        token: s.token || opened.token,
        download: opened.download || 'none',
        theme: opened.theme || null,
        error: null,
        allowedOrigins: opened.allowed_origins || [],
      }));
      schedule(opened.expires_at);
    },
    [schedule],
  );

  useEffect(() => {
    if (!linkToken) return;
    let cancelled = false;
    openSession(linkToken, scope)
      .then((opened) => {
        if (cancelled) return;
        apply(opened);
        if (opened.single_use) {
          // The link is spent; keep it out of the address bar, history and any copied URL.
          const url = new URL(window.location.href);
          url.searchParams.delete('token');
          window.history.replaceState(window.history.state, '', url.toString());
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Embed could not open';
        setState((s) => ({ ...s, status: 'error', error: message }));
        notifyEmbedError(message, 'session_failed');
        // A host using the SDK's getToken answers this with a fresh token.
        postEmbedMessage('token-expired', { reason: 'open_failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [linkToken, scope, apply]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = hostMessage(event, allowedRef.current);
      if (!msg || msg.type !== 'set-token') return;
      const next = (msg.payload as { token?: unknown } | undefined)?.token;
      if (typeof next !== 'string' || !next) return;
      openSession(next, scope)
        .then((opened) => {
          apply(opened);
          postEmbedMessage('token-updated', { expiresAt: opened.expires_at });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Embed could not renew';
          notifyEmbedError(message, 'token_refresh_failed');
        });
    };
    window.addEventListener('message', onMessage);
    const pendingTimers = timers;
    return () => {
      window.removeEventListener('message', onMessage);
      pendingTimers.current.forEach((id) => window.clearTimeout(id));
    };
  }, [scope, apply]);

  return state;
}

/** Commands the host page sends (the SDK's setFilters, refresh, setPage, exportImage). */
export function useEmbedHostCommands(
  allowedOrigins: string[],
  handlers: Partial<Record<'set-filters' | 'refresh' | 'set-page' | 'export', (payload: unknown) => void>>,
): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const allowedKey = allowedOrigins.join(',');
  useEffect(() => {
    const allowed = allowedKey ? allowedKey.split(',') : [];
    const onMessage = (event: MessageEvent) => {
      const msg = hostMessage(event, allowed);
      if (!msg) return;
      const handler = handlersRef.current[msg.type as keyof typeof handlers];
      if (!handler) return;
      try {
        handler(msg.payload);
        postEmbedMessage('command-result', { command: msg.type, ok: true });
      } catch (err) {
        postEmbedMessage('command-result', {
          command: msg.type,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [allowedKey]);
}
