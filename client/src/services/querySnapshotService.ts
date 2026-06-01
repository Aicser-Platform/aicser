type AuthenticatedFetch = (
  url: string,
  options?: RequestInit,
) => Promise<unknown>;

export type SaveQuerySnapshotArgs = {
  name: string;
  sql: string;
  dataSourceId: string;
  rows: Record<string, unknown>[];
  organizationId?: string;
  projectId?: string;
};

export async function saveQuerySnapshot(
  authenticatedFetch: AuthenticatedFetch,
  args: SaveQuerySnapshotArgs,
): Promise<void> {
  const params = new URLSearchParams();
  if (args.organizationId) params.set('organization_id', args.organizationId);
  if (args.projectId) params.set('project_id', args.projectId);
  const qs = params.toString();
  const url = `/api/queries/snapshots${qs ? `?${qs}` : ''}`;
  const columnKeys = args.rows.length && args.rows[0] ? Object.keys(args.rows[0]) : [];

  await authenticatedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: args.name,
      sql: args.sql,
      data_source_id: args.dataSourceId,
      rows: args.rows,
      columns: columnKeys,
      organization_id: args.organizationId,
      project_id: args.projectId,
    }),
  });
}
