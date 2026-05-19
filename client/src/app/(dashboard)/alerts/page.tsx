import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEAlertsPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.AlertsPage })),
  { ssr: false }
);

export default function AlertsPage() {
  if (!isEE) redirect('/dashboards');
  return <EEAlertsPage />;
}
