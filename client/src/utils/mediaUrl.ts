import { getBackendUrl } from './backendUrl';

const VIDEO_EXTENSION = /\.(webm|mp4|ogg|mov|m4v)(?:$|[?#])/i;

/** True when a resolved media URL should play as video, not a frozen thumbnail. */
export function isVideoMediaUrl(url?: string | null): boolean {
  const value = (url || '').trim();
  if (!value) return false;
  if (value.startsWith('data:video/') || value.startsWith('blob:')) return true;
  try {
    const parsed = new URL(value, 'http://aicser.local');
    if (VIDEO_EXTENSION.test(parsed.pathname)) return true;
    const mime = parsed.searchParams.get('mime') || parsed.searchParams.get('type') || '';
    return mime.toLowerCase().startsWith('video/');
  } catch {
    return VIDEO_EXTENSION.test(value);
  }
}

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
