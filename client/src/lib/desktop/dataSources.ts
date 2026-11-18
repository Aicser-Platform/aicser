'use client';

import { useDataSourceSchema as useWebDataSourceSchema, useDataSources as useWebDataSources } from '@/hooks/useDataSources';

/** The desktop's `useDataSources(projectId)` shape (a query with `data`) over the web hook. */
export function useDataSources(projectId: string | null) {
  const { dataSources, error, isLoading, refetch } = useWebDataSources(projectId);
  return { data: projectId === null ? undefined : dataSources, error: error as Error | null, isLoading, refetch };
}


export interface SchemaColumn {
  name: string;
  type: string;
}
export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

/** The desktop's `useDataSourceSchema(id)` shape (`data.tables` of {name, columns: {name, type}}) over the web hook. */
export function useDataSourceSchema(id: string | null) {
  const { schema, error, isLoading } = useWebDataSourceSchema(id);
  const tables: SchemaTable[] = (schema?.tables ?? []).map((t) => ({
    name: t.name || 'data',
    columns: (t.columns ?? []).map((c) => ({ name: c.name, type: String(c.type ?? 'string') })),
  }));
  return { data: id ? { tables } : undefined, error: error as Error | null, isLoading, refetch: () => undefined };
}
