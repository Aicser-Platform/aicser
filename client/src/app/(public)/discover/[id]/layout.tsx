import type { Metadata } from 'next';
import { fetchPublicFeedItemMeta } from '@/lib/publicFeedApi';

type Props = { params: { id: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await fetchPublicFeedItemMeta(params.id);
  if (!item) {
    return {
      title: 'Insight | Aicser Discover',
      description: 'Public data insights shared on Aicser Discover.',
    };
  }

  const author = item.author?.name || item.author?.username;
  const title = item.title ? `${item.title} | Aicser Discover` : 'Aicser Discover';
  const description =
    item.description?.trim() ||
    (author ? `Snapshot insight by ${author} on Aicser Discover.` : 'Trusted snapshot insight on Aicser Discover.');

  const site = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const url = `${site.replace(/\/$/, '')}/discover/${params.id}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      type: 'article',
      siteName: 'Aicser Discover',
      images: [{ url: `/discover/${params.id}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default function DiscoverItemLayout({ children }: { children: React.ReactNode }) {
  return children;
}
