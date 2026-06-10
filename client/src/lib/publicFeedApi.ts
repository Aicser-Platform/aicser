import { getBackendUrl } from '@/utils/backendUrl';

export type PublicFeedItemMeta = {
  id: string;
  title: string;
  description?: string | null;
  author?: { name?: string; username?: string };
};

export async function fetchPublicFeedItemMeta(itemId: string): Promise<PublicFeedItemMeta | null> {
  const base = getBackendUrl();
  try {
    const res = await fetch(`${base}/api/feed/public/${itemId}`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicFeedItemMeta;
  } catch {
    return null;
  }
}

export async function fetchPublicAuthorMeta(username: string): Promise<{ name?: string; username?: string } | null> {
  const base = getBackendUrl();
  const handle = encodeURIComponent(username.replace(/^@/, ''));
  try {
    const res = await fetch(`${base}/api/feed/public/authors/${handle}?limit=1`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { author?: { name?: string; username?: string } };
    return data.author ?? null;
  } catch {
    return null;
  }
}
