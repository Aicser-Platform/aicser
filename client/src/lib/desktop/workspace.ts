'use client';

import { useMemo } from 'react';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';

/** The desktop's `useWorkspace()` on the web's stores: the header's organization and project (ids as strings). */
export function useWorkspace() {
  const project = useProjectStore((s) => s.currentProject);
  const organization = useOrganizationStore((s) => s.currentOrganization);
  return useMemo(
    () => ({
      project: project ? { ...project, id: String(project.id), name: project.name } : null,
      organization: organization ? { ...organization, id: String(organization.id), name: organization.name } : null,
    }),
    [project, organization]
  );
}
