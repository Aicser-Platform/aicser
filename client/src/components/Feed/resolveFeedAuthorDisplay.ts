/**
 * Keep feed author chrome (avatar + display name) in sync with the live
 * profile — especially for the viewer's own posts after they replace a photo.
 *
 * Feed API already serializes live users.avatar_url, but React Query can hold
 * list pages longer than a profile update. Overlay the current profile when
 * the author is the signed-in user so composer, cards, and comments match.
 */

export type FeedAuthorIdentity = {
  id?: string | null;
  username?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
};

export function normalizeFeedHandle(value?: string | null): string {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

export function isSameFeedAuthor(
  author: FeedAuthorIdentity | null | undefined,
  viewerId?: string | null,
  viewerUsername?: string | null,
): boolean {
  if (!author) return false;
  if (viewerId && author.id && String(author.id) === String(viewerId)) return true;
  const a = normalizeFeedHandle(author.username);
  const b = normalizeFeedHandle(viewerUsername);
  return Boolean(a && b && a === b);
}

export function resolveFeedAuthorAvatar(opts: {
  author?: FeedAuthorIdentity | null;
  viewerId?: string | null;
  viewerUsername?: string | null;
  viewerAvatarUrl?: string | null;
}): string | undefined {
  const { author, viewerId, viewerUsername, viewerAvatarUrl } = opts;
  const live = (viewerAvatarUrl || '').trim() || undefined;
  if (isSameFeedAuthor(author, viewerId, viewerUsername) && live) {
    return live;
  }
  const fromAuthor = (author?.avatarUrl || '').trim();
  return fromAuthor || undefined;
}

export function resolveFeedAuthorName(opts: {
  author?: FeedAuthorIdentity | null;
  viewerId?: string | null;
  viewerUsername?: string | null;
  viewerDisplayName?: string | null;
  fallback?: string;
}): string {
  const { author, viewerId, viewerUsername, viewerDisplayName, fallback = '' } = opts;
  const live = (viewerDisplayName || '').trim();
  if (isSameFeedAuthor(author, viewerId, viewerUsername) && live) {
    return live;
  }
  return (author?.name || '').trim() || fallback;
}
