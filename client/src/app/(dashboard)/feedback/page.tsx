import { redirect } from 'next/navigation';
import FeedbackPageClient from './FeedbackPageClient';
import { isEnterpriseEdition } from '@/utils/appPaths';

export default function FeedbackPage() {
  if (!isEnterpriseEdition()) redirect('/dashboards');
  return <FeedbackPageClient />;
}
