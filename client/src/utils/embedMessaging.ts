export type EmbedMessageType = 'ready' | 'resize' | 'navigate' | 'error' | 'ping';

export interface EmbedMessage<T = unknown> {
  source: 'aicser-embed';
  type: EmbedMessageType;
  payload?: T;
}

export interface EmbedResizePayload {
  height: number;
  width?: number;
}

export interface EmbedNavigatePayload {
  path: string;
}

export interface EmbedErrorPayload {
  message: string;
  code?: string;
}

const MESSAGE_SOURCE = 'aicser-embed';

export function isEmbedMessage(data: unknown): data is EmbedMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as EmbedMessage).source === MESSAGE_SOURCE &&
    typeof (data as EmbedMessage).type === 'string'
  );
}

/** Send a postMessage to the parent frame (no-op when not embedded). */
export function postEmbedMessage<T>(
  type: EmbedMessageType,
  payload?: T,
  targetOrigin: string = '*'
): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  const message: EmbedMessage<T> = { source: MESSAGE_SOURCE, type, payload };
  window.parent.postMessage(message, targetOrigin);
}

/** Notify parent that the embed finished loading. */
export function notifyEmbedReady(extra?: Record<string, unknown>): void {
  postEmbedMessage('ready', extra);
}

/** Ask parent to resize the iframe container. */
export function notifyEmbedResize(height: number, width?: number): void {
  postEmbedMessage<EmbedResizePayload>('resize', { height, width });
}

/** Report an error to the parent page. */
export function notifyEmbedError(message: string, code?: string): void {
  postEmbedMessage<EmbedErrorPayload>('error', { message, code });
}

/** Subscribe to embed messages from child iframes (parent-side helper). */
export function listenForEmbedMessages(
  handler: (message: EmbedMessage, event: MessageEvent) => void,
  allowedOrigin?: string
): () => void {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: MessageEvent) => {
    if (allowedOrigin && event.origin !== allowedOrigin) return;
    if (!isEmbedMessage(event.data)) return;
    handler(event.data, event);
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
