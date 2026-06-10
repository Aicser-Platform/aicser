export type EmbedScope = 'dashboard' | 'chart' | 'chat';

export type EmbedMessageType = 'ready' | 'resize' | 'navigate' | 'error' | 'ping';

export interface EmbedMessage<T = unknown> {
  source: 'aicser-embed';
  type: EmbedMessageType;
  payload?: T;
}

export type { EmbedObservabilityOptions } from './observability.js';
import type { EmbedObservabilityOptions } from './observability.js';

export interface EmbedOptions {
  /** Base URL of your Aicser deployment, e.g. https://app.aicser.com */
  baseUrl: string;
  /** Signed JWT embed token from Settings → Embed or POST /api/embed/tokens */
  token: string;
  /** Optional dashboard page id */
  pageId?: string;
  /** Optional runtime filters applied on load */
  filters?: Array<{ field: string; operator: string; value: unknown }>;
  /** CSS class applied to the iframe element */
  className?: string;
  /** Inline styles for the iframe */
  style?: Partial<CSSStyleDeclaration> | Record<string, string>;
  /** postMessage target origin (defaults to baseUrl origin) */
  targetOrigin?: string;
  /** Optional Sentry reporting for third-party host pages */
  observability?: EmbedObservabilityOptions;
  /** Called when the embed sends a ready event */
  onReady?: (message: EmbedMessage) => void;
  /** Called when the embed requests a container resize */
  onResize?: (height: number, width?: number) => void;
  /** Called when viewer changes filters inside embed */
  onFilterChange?: (filters: Array<{ field: string; operator: string; value: unknown }>) => void;
  /** Called on embed errors */
  onError?: (message: string, code?: string) => void;
}

export interface EmbedHandle {
  iframe: HTMLIFrameElement;
  destroy: () => void;
}

const MESSAGE_SOURCE = 'aicser-embed';

function buildEmbedUrl(
  baseUrl: string,
  path: string,
  token: string,
  opts?: Pick<EmbedOptions, 'pageId' | 'filters'>
): string {
  const url = new URL(path, baseUrl.replace(/\/$/, '') + '/');
  url.searchParams.set('token', token);
  if (opts?.pageId) url.searchParams.set('page', opts.pageId);
  if (opts?.filters?.length) {
    url.searchParams.set('filters', encodeURIComponent(JSON.stringify(opts.filters)));
  }
  return url.toString();
}

function createIframe(src: string, options: EmbedOptions): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = 'Aicser embed';
  iframe.setAttribute('allow', 'clipboard-write');
  iframe.style.width = options.style?.width?.toString() || '100%';
  iframe.style.height = options.style?.height?.toString() || '600px';
  iframe.style.border = options.style?.border?.toString() || '0';
  if (options.className) iframe.className = options.className;
  return iframe;
}

function mountEmbed(path: string, container: HTMLElement, options: EmbedOptions): EmbedHandle {
  const src = buildEmbedUrl(options.baseUrl, path, options.token, {
    pageId: options.pageId,
    filters: options.filters,
  });
  const iframe = createIframe(src, options);
  container.innerHTML = '';
  container.appendChild(iframe);

  void import('./observability.js').then(({ initEmbedObservability }) =>
    initEmbedObservability(options.observability),
  );

  const targetOrigin = options.targetOrigin || new URL(options.baseUrl).origin;
  const listener = (event: MessageEvent) => {
    if (event.origin !== targetOrigin) return;
    const data = event.data as EmbedMessage;
    if (!data || data.source !== MESSAGE_SOURCE) return;

    if (data.type === 'ready') options.onReady?.(data);
    if (data.type === 'resize' && data.payload && typeof data.payload === 'object') {
      const payload = data.payload as { height?: number; width?: number };
      if (typeof payload.height === 'number') {
        iframe.style.height = `${payload.height}px`;
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
      const payload = data.payload as { filters?: EmbedOptions['filters'] };
      if (payload.filters) options.onFilterChange?.(payload.filters);
    }
  };

  window.addEventListener('message', listener);
  return {
    iframe,
    destroy: () => {
      window.removeEventListener('message', listener);
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

/** Embed a chart by slug or id. */
export function embedChart(container: HTMLElement, slug: string, options: EmbedOptions): EmbedHandle {
  return mountEmbed(`embed/chart/${encodeURIComponent(slug)}`, container, options);
}

/** Embed the minimal AI chat surface (Enterprise Edition). */
export function embedChat(container: HTMLElement, options: EmbedOptions): EmbedHandle {
  return mountEmbed('embed/chat', container, options);
}

/** Vanilla namespace for script-tag usage. */
export const Aicser = {
  embedDashboard,
  embedChart,
  embedChat,
};

export {
  initEmbedObservability,
  captureEmbedError,
} from './observability.js';

export default Aicser;
