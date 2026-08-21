/** React Query cache keys for data sources — standalone to avoid circular imports. */

export const dataSourceKeys = {
  all: ['data-sources'] as const,
  list: (projectId?: string | null) => ['data-sources', 'list', projectId ?? null] as const,
  detail: (id: string) => ['data-sources', id] as const,
  schema: (id: string) => ['data-sources', id, 'schema'] as const,
  accessGrants: (id: string) => ['data-sources', id, 'access-grants'] as const,
  rlsPolicies: (id: string) => ['data-sources', id, 'rls-policies'] as const,
  clsPolicies: (id: string) => ['data-sources', id, 'cls-policies'] as const,
  myRowAccess: (id: string) => ['data-sources', id, 'my-row-access'] as const,
  rlsProjectAttributes: (id: string, projectId?: string | null) =>
    ['data-sources', id, 'rls-project-attributes', projectId ?? null] as const,
};

export const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase()
);

export function resolveDataSourceProjectId(
  projectId: string | null | undefined,
  currentProjectId: string | number | null | undefined,
  allProjects?: boolean
): string | undefined {
  if (allProjects) return undefined;
  if (projectId !== undefined && projectId !== null && projectId !== '') {
    return String(projectId);
  }
  if (isEnterpriseEdition && currentProjectId != null && currentProjectId !== '') {
    return String(currentProjectId);
  }
  return undefined;
}
