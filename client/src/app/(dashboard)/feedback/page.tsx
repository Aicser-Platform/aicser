import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEFeedbackPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.FeedbackPage })),
  { ssr: false }
);

export default function FeedbackPage() {
  if (!isEE) redirect('/dashboards');
  return <EEFeedbackPage />;
}
