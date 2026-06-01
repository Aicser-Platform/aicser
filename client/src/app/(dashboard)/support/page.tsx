import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EESupportPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.SupportPage })),
  { ssr: false }
);

export default function SupportPage() {
  if (!isEE) redirect('/dashboards');
  return <EESupportPage />;
}
