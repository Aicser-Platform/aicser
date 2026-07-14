import { getBackendUrl } from './backendUrl';

export function resolveBackendMediaUrl(url?: string | null): string | undefined {
  const value = (url || '').trim();
  if (!value) return undefined;

  try {
    const parsed = new URL(value, 'http://aicser.local');
    if (parsed.pathname.startsWith('/media/feed-thumbnails/')) {
      const filename = parsed.pathname.split('/').pop();
      return filename ? `/api/media/feed-thumbnails/${encodeURIComponent(filename)}` : undefined;
    }
  } catch {
    // Fall through to generic URL handling.
  }

  if (/^(?:https?:)?\/\//i.test(value) || /^(?:data|blob):/i.test(value)) {
    return value;
  }

  const path = value.startsWith('/') ? value : `/${value}`;
  return `${getBackendUrl()}${path}`;
}
