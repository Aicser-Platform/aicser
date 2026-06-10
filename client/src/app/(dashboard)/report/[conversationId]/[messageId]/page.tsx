import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEReportPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.ReportPage })),
  { ssr: false }
);

export default function ReportPage() {
  if (!isEE) redirect('/dashboards');
  return <EEReportPage />;
}
