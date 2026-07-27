import { redirect } from 'next/navigation';
import ReportPageClient from './ReportPageClient';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

export default function ReportPage() {
  if (!isEE) redirect('/dashboards');
  return <ReportPageClient />;
}
