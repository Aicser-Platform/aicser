import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEDataPlatformPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.DataPlatformPage })),
  { ssr: false }
);

export default function DataPlatformPage() {
  if (!isEE) redirect('/dashboards');
  return <EEDataPlatformPage />;
}
