import { toast as sonner } from 'sonner';

/**
 * AntD `message`'s call shapes on sonner (the desktop's toasts), so a page moving off AntD swaps its import and
 * keeps its calls: `message.success('Saved')`, `message.error({ content, key, duration })`, `message.destroy(key)`.
 * Durations are seconds, as in AntD (0 = stays until closed); `key` replaces the toast with the same key.
 */
type Content = string | { content: string; key?: string | number; duration?: number };
type Level = 'success' | 'error' | 'info' | 'warning' | 'loading';

function show(level: Level, content: Content, duration?: number): string | number {
  const options =
    typeof content === 'string' ? { duration } : { id: content.key, duration: content.duration ?? duration };
  const text = typeof content === 'string' ? content : content.content;
  const ms = options.duration === undefined ? undefined : options.duration === 0 ? Infinity : options.duration * 1000;
  const shown = level === 'info' ? sonner.info : sonner[level];
  return shown(text, { id: options.id, duration: ms });
}

export const message = {
  success: (content: Content, duration?: number) => show('success', content, duration),
  error: (content: Content, duration?: number) => show('error', content, duration),
  info: (content: Content, duration?: number) => show('info', content, duration),
  warning: (content: Content, duration?: number) => show('warning', content, duration),
  loading: (content: Content, duration?: number) => show('loading', content, duration ?? 0),
  open: ({ type = 'info', ...rest }: { type?: Level; content: string; key?: string | number; duration?: number }) =>
    show(type, rest),
  destroy: (key?: string | number) => sonner.dismiss(key),
};
