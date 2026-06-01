const FEED_HIGHLIGHT_KEY = 'feed_highlight_post_id';

export function stashFeedHighlight(postId: string): void {
  if (typeof window === 'undefined' || !postId) return;
  try {
    sessionStorage.setItem(FEED_HIGHLIGHT_KEY, postId);
  } catch {
    // ignore
  }
}

export function peekFeedHighlight(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(FEED_HIGHLIGHT_KEY);
  } catch {
    return null;
  }
}

export function consumeFeedHighlight(): string | null {
  const id = peekFeedHighlight();
  if (!id || typeof window === 'undefined') return id;
  try {
    sessionStorage.removeItem(FEED_HIGHLIGHT_KEY);
  } catch {
    // ignore
  }
  return id;
}

export function resolveFeedHighlightPostId(queryPostId?: string | null): string {
  return (queryPostId || peekFeedHighlight() || '').trim();
}
