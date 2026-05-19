import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const EEProjectsPage = dynamic(
  () => import('@/ee').then((m) => ({ default: m.ProjectsPage })),
  { ssr: false }
);

export default function ProjectsPage() {
  if (!isEE) redirect('/dashboards');
  return <EEProjectsPage />;
}
