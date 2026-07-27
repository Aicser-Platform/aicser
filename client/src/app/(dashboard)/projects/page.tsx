import { redirect } from 'next/navigation';
import ProjectsPageClient from './ProjectsPageClient';

const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

export default function ProjectsPage() {
  if (!isEE) redirect('/dashboards');
  return <ProjectsPageClient />;
}
