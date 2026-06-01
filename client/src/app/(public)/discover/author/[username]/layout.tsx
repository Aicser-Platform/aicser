import type { Metadata } from 'next';
import { fetchPublicAuthorMeta } from '@/lib/publicFeedApi';

type Props = { params: { username: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const handle = params.username.replace(/^@/, '');
  const author = await fetchPublicAuthorMeta(handle);
  const name = author?.name || author?.username || handle;
  const title = `${name} | Aicser Discover`;
  const description = `Public insights published by ${name} on Aicser Discover.`;

  return {
    title,
    description,
    openGraph: { title, description, type: 'profile' },
  };
}

export default function AuthorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
