import { redirect } from 'next/navigation';
import SupportPageClient from './SupportPageClient';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

export default function SupportPage() {
  if (!isEE) redirect('/dashboards');
  return <SupportPageClient />;
}
