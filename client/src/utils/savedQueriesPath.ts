import { useProjectStore } from '@/stores/useProjectStore';

/**
 * The saved-queries list for the current organization and project, as the SQL editor lists it.
 * Without the scope the server returns only queries saved outside any project, so pickers showed
 * a query's id ("3") instead of its name.
 */
export function savedQueriesPath(): string {
  const { currentProject, currentProjectId } = useProjectStore.getState();
  const params = new URLSearchParams();
  if (currentProject && 'organization_id' in currentProject && currentProject.organization_id != null) {
    params.set('organization_id', String(currentProject.organization_id));
  }
  if (currentProjectId != null) params.set('project_id', String(currentProjectId));
  const qs = params.toString();
  return qs ? `queries/saved-queries?${qs}` : 'queries/saved-queries';
}
