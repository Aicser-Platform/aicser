import { redirect } from 'next/navigation';
import SupportPageClient from './SupportPageClient';
import { isEnterpriseEdition } from '@/utils/appPaths';

export default function SupportPage() {
  if (!isEnterpriseEdition()) redirect('/dashboards');
  return <SupportPageClient />;
}
