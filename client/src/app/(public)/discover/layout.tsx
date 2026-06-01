import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Discover | Aicser',
  description:
    'Browse public dashboards, charts, and AI insights shared as trusted snapshots — explore without an account.',
  openGraph: {
    title: 'Aicser Discover — public data insights',
    description: 'Trusted snapshots from data teams. Explore, follow creators, and remix in Aicser.',
    type: 'website',
  },
};

export default function DiscoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
