import { redirect } from 'next/navigation';
import ReportPageClient from './ReportPageClient';
import { isEnterpriseEdition } from '@/utils/appPaths';

export default function ReportPage() {
  if (!isEnterpriseEdition()) redirect('/dashboards');
  return <ReportPageClient />;
}
