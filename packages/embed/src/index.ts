export type EmbedScope = 'dashboard' | 'chart' | 'chat' | 'report';

/** Messages an embed page sends to the page hosting it. */
export type EmbedMessageType =
  | 'ready'
  | 'resize'
  | 'navigate'
  | 'error'
  | 'ping'
  | 'token-expiring'
  | 'token-expired'
  | 'token-updated'
  | 'command-result';

export interface EmbedMessage<T = unknown> {
  source: 'aicser-embed';
  type: EmbedMessageType;
  payload?: T;
}

export interface EmbedFilter {
  field: string;
  operator: string;
  value: unknown;
}

export type { EmbedObservabilityOptions } from './observability.js';
import type { EmbedObservabilityOptions } from './observability.js';

export interface EmbedOptions {
  /** Base URL of your Aicser deployment, e.g. https://app.aicser.com */
  baseUrl: string;
  /**
   * Embed token: a public link token from Settings → Embed, or a signed per-visitor token your
   * server gets from POST /api/embed/sign (see `@aicser/embed/server`). Optional when
   * `getToken` is given.
   */
  token?: string;
  /**
   * Fetches a fresh signed token from your server. Called when there is no `token`, when the
   * session is about to run out, and when the embed reloads (a signed link opens only once).
   * With it, sessions renew without reloading the view.
   */
  getToken?: () => Promise<string>;
  /** Optional dashboard page id */
  pageId?: string;
  /** Optional runtime filters applied on load */
  filters?: EmbedFilter[];
  /** CSS class applied to the iframe element */
  className?: string;
  /** Inline styles for the iframe */
  style?: Partial<CSSStyleDeclaration> | Record<string, string>;
  /** Resize the iframe to the embed's content height (default true) */
  autoResize?: boolean;
  /** postMessage target origin (defaults to baseUrl origin) */
  targetOrigin?: string;
  /** Optional Sentry reporting for third-party host pages */
  observability?: EmbedObservabilityOptions;
  /** Called when the embed has loaded its content */
  onReady?: (message: EmbedMessage) => void;
  /** Called when the embed requests a container resize */
  onResize?: (height: number, width?: number) => void;
  /** Called when the viewer changes filters inside the embed */
  onFilterChange?: (filters: EmbedFilter[]) => void;
  /** Called on embed errors */
  onError?: (message: string, code?: string) => void;
  /** Called when the session ran out and could not be renewed (no `getToken`, or it failed) */
  onTokenExpired?: () => void;
}

export interface EmbedHandle {
  iframe: HTMLIFrameElement;
  /** Replace the viewer's filters (the embed's locked filters still apply on the server). */
  setFilters: (filters: EmbedFilter[]) => Promise<void>;
  /** Re-run every chart. */
  refresh: () => Promise<void>;
  /** Show another page of a multi-page dashboard. */
  setPage: (pageId: string) => Promise<void>;
  /** Download what's on screen, when the embed's download setting allows it. */
  exportImage: (format?: 'png' | 'pdf') => Promise<void>;
  /** Hand the embed a fresh token (for hosts that renew tokens themselves). */
  setToken: (token: string) => void;
  /** Listen to any embed message; returns an unsubscribe function. */
  on: (type: EmbedMessageType, handler: (payload: unknown) => void) => () => void;
  destroy: () => void;
}

export class EmbedCommandError extends Error {
  constructor(
    message: string,
    readonly command: string,
  ) {
    super(message);
    this.name = 'EmbedCommandError';
  }
}

const MESSAGE_SOURCE = 'aicser-embed';
const HOST_SOURCE = 'aicser-host';
const COMMAND_TIMEOUT_MS = 15_000;

function buildEmbedUrl(
  baseUrl: string,
  path: string,
  token: string,
  opts?: Pick<EmbedOptions, 'pageId' | 'filters'>
): string {
  const url = new URL(path, baseUrl.replace(/\/$/, '') + '/');
  if (token) url.searchParams.set('token', token);
  if (opts?.pageId) url.searchParams.set('page', opts.pageId);
  if (opts?.filters?.length) {
    url.searchParams.set('filters', encodeURIComponent(JSON.stringify(opts.filters)));
  }
  return url.toString();
}

function createIframe(options: EmbedOptions): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.title = 'Aicser embed';
  iframe.setAttribute('allow', 'clipboard-write; fullscreen');
  // The embed checks which site shows it; keep the origin in the referrer.
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  iframe.style.width = options.style?.width?.toString() || '100%';
  iframe.style.height = options.style?.height?.toString() || '600px';
  iframe.style.border = options.style?.border?.toString() || '0';
  if (options.className) iframe.className = options.className;
  return iframe;
}

function mountEmbed(path: string, container: HTMLElement, options: EmbedOptions): EmbedHandle {
  const iframe = createIframe(options);
  container.innerHTML = '';
  container.appendChild(iframe);

  void import('./observability.js').then(({ initEmbedObservability }) =>
    initEmbedObservability(options.observability),
  );

  const targetOrigin = options.targetOrigin || new URL(options.baseUrl).origin;
  const listeners = new Map<EmbedMessageType, Set<(payload: unknown) => void>>();
  const pending: Array<{ command: string; resolve: () => void; reject: (e: Error) => void; timer: number }> = [];
  const queued: Array<() => void> = [];
  let ready = false;
  let destroyed = false;
  let renewing = false;

  const post = (type: string, payload?: unknown) => {
    iframe.contentWindow?.postMessage({ source: HOST_SOURCE, type, payload }, targetOrigin);
  };

  const load = (token: string) => {
    ready = false;
    iframe.src = buildEmbedUrl(options.baseUrl, path, token, {
      pageId: options.pageId,
      filters: options.filters,
    });
  };

  const renew = async (reload: boolean) => {
    if (!options.getToken) {
      options.onTokenExpired?.();
      return;
    }
    if (renewing) return;
    renewing = true;
    try {
      const token = await options.getToken();
      if (destroyed) return;
      if (reload) load(token);
      else post('set-token', { token });
    } catch (err) {
      options.onError?.(err instanceof Error ? err.message : 'Could not renew the embed token', 'token_refresh_failed');
      options.onTokenExpired?.();
    } finally {
      renewing = false;
    }
  };

  const command = (name: string, payload?: unknown): Promise<void> =>
    new Promise((resolve, reject) => {
      const send = () => {
        const timer = window.setTimeout(() => {
          const i = pending.findIndex((p) => p.timer === timer);
          if (i >= 0) pending.splice(i, 1);
          reject(new EmbedCommandError(`The embed did not answer ${name}`, name));
        }, COMMAND_TIMEOUT_MS);
        pending.push({ command: name, resolve, reject, timer });
        post(name, payload);
      };
      if (ready) send();
      else queued.push(send);
    });

  const listener = (event: MessageEvent) => {
    if (event.origin !== targetOrigin || event.source !== iframe.contentWindow) return;
    const data = event.data as EmbedMessage;
    if (!data || data.source !== MESSAGE_SOURCE) return;
    listeners.get(data.type)?.forEach((handler) => handler(data.payload));

    if (data.type === 'ready') {
      options.onReady?.(data);
      // The page layout says ready before its content loads; content readiness names a kind,
      // and only then can the view take commands.
      if ((data.payload as { kind?: string } | undefined)?.kind) {
        ready = true;
        queued.splice(0).forEach((send) => send());
      }
    }
    if (data.type === 'resize' && data.payload && typeof data.payload === 'object') {
      const payload = data.payload as { height?: number; width?: number };
      if (typeof payload.height === 'number') {
        if (options.autoResize !== false) iframe.style.height = `${payload.height}px`;
        options.onResize?.(payload.height, payload.width);
      }
    }
    if (data.type === 'error' && data.payload && typeof data.payload === 'object') {
      const payload = data.payload as { message?: string; code?: string };
      const message = payload.message || 'Embed error';
      void import('./observability.js').then(({ captureEmbedError }) =>
        captureEmbedError(new Error(message), { code: payload.code, path }, options.observability),
      );
      options.onError?.(message, payload.code);
    }
    if (data.type === 'navigate' && data.payload && typeof data.payload === 'object') {
      const payload = data.payload as { filters?: EmbedFilter[] };
      if (payload.filters) options.onFilterChange?.(payload.filters);
    }
    if (data.type === 'token-expiring') void renew(false);
    if (data.type === 'token-expired') {
      // A link that failed to open (already used, e.g. after a reload) needs a fresh page load;
      // a session that ran out can take a new token in place.
      const reason = (data.payload as { reason?: string } | undefined)?.reason;
      void renew(reason === 'open_failed');
    }
    if (data.type === 'command-result' && data.payload && typeof data.payload === 'object') {
      const result = data.payload as { command?: string; ok?: boolean; error?: string };
      const i = pending.findIndex((p) => p.command === result.command);
      if (i >= 0) {
        const [p] = pending.splice(i, 1);
        window.clearTimeout(p.timer);
        if (result.ok) p.resolve();
        else p.reject(new EmbedCommandError(result.error || `${p.command} failed`, p.command));
      }
    }
  };

  window.addEventListener('message', listener);
  if (options.token) load(options.token);
  else void renew(true);

  return {
    iframe,
    setFilters: (filters) => command('set-filters', { filters }),
    refresh: () => command('refresh'),
    setPage: (pageId) => command('set-page', { pageId }),
    exportImage: (format = 'png') => command('export', { format }),
    setToken: (token) => post('set-token', { token }),
    on: (type, handler) => {
      const set = listeners.get(type) || new Set();
      set.add(handler);
      listeners.set(type, set);
      return () => set.delete(handler);
    },
    destroy: () => {
      destroyed = true;
      window.removeEventListener('message', listener);
      pending.splice(0).forEach((p) => {
        window.clearTimeout(p.timer);
        p.reject(new EmbedCommandError('The embed was removed', p.command));
      });
      iframe.remove();
    },
  };
}

/** Embed a read-only dashboard by id. */
export function embedDashboard(
  container: HTMLElement,
  dashboardId: string,
  options: EmbedOptions
): EmbedHandle {
  return mountEmbed(`embed/dashboard/${encodeURIComponent(dashboardId)}`, container, options);
}

/** Embed a chart by id. */
export function embedChart(container: HTMLElement, slug: string, options: EmbedOptions): EmbedHandle {
  return mountEmbed(`embed/chart/${encodeURIComponent(slug)}`, container, options);
}

/** Embed the AI assistant (Enterprise Edition). */
export function embedChat(container: HTMLElement, options: EmbedOptions): EmbedHandle {
  return mountEmbed('embed/chat', container, options);
}

/**
 * Embed a read-only executive report (Enterprise Edition).
 * `reportId` is `${conversationId}:${messageId}` — the same shape Settings → Embed and
 * `POST /api/embed/sign` (scope `report`) mint.
 */
export function embedReport(
  container: HTMLElement,
  reportId: string,
  options: EmbedOptions
): EmbedHandle {
  return mountEmbed(`embed/report/${encodeURIComponent(reportId)}`, container, options);
}

/** Vanilla namespace for script-tag usage. */
export const Aicser = {
  embedDashboard,
  embedChart,
  embedChat,
  embedReport,
};

export {
  initEmbedObservability,
  captureEmbedError,
} from './observability.js';

export default Aicser;
