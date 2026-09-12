import { redirect } from 'next/navigation';
import ProjectsPageClient from './ProjectsPageClient';
import { isEnterpriseEdition } from '@/utils/appPaths';

export default function ProjectsPage() {
  if (!isEnterpriseEdition()) redirect('/dashboards');
  return <ProjectsPageClient />;
}
