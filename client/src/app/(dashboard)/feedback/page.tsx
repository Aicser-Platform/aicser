import { redirect } from 'next/navigation';
import FeedbackPageClient from './FeedbackPageClient';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

export default function FeedbackPage() {
  if (!isEE) redirect('/dashboards');
  return <FeedbackPageClient />;
}
