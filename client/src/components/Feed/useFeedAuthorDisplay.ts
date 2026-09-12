'use client';

import { useMemo } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useProfileStore } from '@/stores/useProfileStore';
import {
  resolveFeedAuthorAvatar,
  resolveFeedAuthorName,
  type FeedAuthorIdentity,
} from '@/components/Feed/resolveFeedAuthorDisplay';

/** Live avatar + display name for a feed author (overlays own profile when self). */
export function useFeedAuthorDisplay(author?: FeedAuthorIdentity | null) {
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);

  return useMemo(() => {
    const viewerUsername = user?.username || profile?.username || null;
    const viewerDisplayName =
      [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
      profile?.username ||
      undefined;
    return {
      avatarUrl: resolveFeedAuthorAvatar({
        author,
        viewerId: user?.id,
        viewerUsername,
        viewerAvatarUrl: profile?.avatar_url,
      }),
      name: resolveFeedAuthorName({
        author,
        viewerId: user?.id,
        viewerUsername,
        viewerDisplayName,
        fallback: author?.name || '',
      }),
    };
  }, [author, user?.id, user?.username, profile?.avatar_url, profile?.first_name, profile?.last_name, profile?.username]);
}
