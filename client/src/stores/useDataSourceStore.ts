import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import * as api from '@/api/dataSources';

// ── Types (kept here so api/ and hooks/ can import them) ──────────────────────

export interface SchemaInfo {
  tables?: Array<{
    name: string;
    schema?: string;
    description?: string;
    rowCount?: number | null;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      primary_key?: boolean;
      unique?: boolean;
      foreign_key?: string;
      default?: unknown;
    }>;
  }>;
  /** Cube.js cube definitions */
  cubes?: unknown;
  /** Named schema list (for multi-schema databases) */
  schemas?: string[];
  /** View definitions (optional, mirrors tables shape) */
  views?: Array<{
    name: string;
    schema?: string;
    columns?: Array<{ name: string; type: string; nullable?: boolean }>;
  }>;
  /** Whether this schema belongs to a knowledge-base data source */
  isKnowledgeBase?: boolean;
  database_info?: {
    name?: string;
    type?: string;
    host?: string;
    port?: number | string;
    username?: string;
  };
  warning?: string;
  raw?: unknown;
  error?: string | null;
}

export interface DataSource {
  id: string;
  name: string;
  type:
    | 'file'
    | 'database'
    | 'warehouse'
    | 'api'
    | 'cube'
    | 'google_sheets'
    | 'sample_duckdb'
    | 'knowledge_base';
  format?: string;
  db_type?: string;
  description?: string;
  connection_config?: Record<string, any>;
  connection_status?: 'connected' | 'failed' | 'unknown' | null;
  schema?: Record<string, any> | null;
  row_count?: number;
  size?: number;
  file_path?: string;
  original_filename?: string;
  sample_data?: any[];
  created_at?: string;
  updated_at?: string;
  last_accessed?: string;
  is_active?: boolean;
  project_id?: string;
  metadata?: Record<string, any>;
}

// ── Zustand UI state (schema cache lives here so it's shared across components)

interface DataSourceUIState {
  selectedId: string | null;
  filterType: string | null;
  schemaCache: Record<string, SchemaInfo>;
  schemaLoading: boolean;
  select: (id: string | null) => void;
  setFilter: (type: string | null) => void;
  setSchemaCache: (id: string, schema: SchemaInfo) => void;
  setSchemaLoading: (loading: boolean) => void;
}

export const useDataSourceStore = create<DataSourceUIState>()(
  devtools(
    (set) => ({
      selectedId: null,
      filterType: null,
      schemaCache: {},
      schemaLoading: false,
      select: (id) => set({ selectedId: id }),
      setFilter: (type) => set({ filterType: type }),
      setSchemaCache: (id, schema) =>
        set((s) => ({ schemaCache: { ...s.schemaCache, [id]: schema } })),
      setSchemaLoading: (loading) => set({ schemaLoading: loading }),
    }),
    { name: 'DataSourceStore' }
  )
);

// ── Query keys (inlined to avoid circular imports with hooks/useDataSources) ──

const DS_KEYS = {
  all: ['data-sources'] as const,
  list: () => ['data-sources', 'list', null] as const,
};

// ── Composite hook — bridges React Query data + Zustand UI state ──────────────
// EE components import this via `useDataSources` from '@/stores/useDataSourceStore'.

export function useDataSources() {
  const store = useDataSourceStore();
  const qc = useQueryClient();
  const selectedId = store.selectedId;
  const schemaCache = store.schemaCache;

  const { data, isLoading } = useQuery({
    queryKey: DS_KEYS.list(),
    queryFn: () => api.listDataSources(),
    select: (res) => res?.data_sources ?? [],
  });

  const dataSources: DataSource[] = data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDataSource(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: DS_KEYS.all }),
  });

  const fetchDataSourceSchema = useCallback(
    async (id: string) => {
      store.setSchemaLoading(true);
      try {
        const res = await api.getDataSourceSchema(id);
        store.setSchemaCache(id, res.schema);
      } finally {
        store.setSchemaLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.setSchemaLoading, store.setSchemaCache]
  );

  useEffect(() => {
    if (!selectedId || schemaCache[selectedId]) return;
    fetchDataSourceSchema(selectedId).catch((error) => {
      console.error('Failed to load data source schema:', error);
    });
  }, [selectedId, schemaCache, fetchDataSourceSchema]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleDataSourceCreated = (event: Event) => {
      const detail = (event as CustomEvent<DataSource>).detail;
      qc.invalidateQueries({ queryKey: DS_KEYS.all });
      if (!detail?.id) return;

      store.select(detail.id);
      if (detail.schema) {
        store.setSchemaCache(detail.id, detail.schema as SchemaInfo);
      }
      fetchDataSourceSchema(detail.id).catch((error) => {
        console.error('Failed to load created data source schema:', error);
      });
    };

    window.addEventListener('datasource-created', handleDataSourceCreated);
    return () => window.removeEventListener('datasource-created', handleDataSourceCreated);
  }, [qc, store, fetchDataSourceSchema]);

  const dataSourceSchemas = new Map<string, SchemaInfo>(
    Object.entries(store.schemaCache)
  );

  const getSelectedDataSource = useCallback(
    () => dataSources.find((ds) => ds.id === store.selectedId) ?? null,
    [dataSources, store.selectedId]
  );

  const refreshDataSources = useCallback(
    () => qc.invalidateQueries({ queryKey: DS_KEYS.all }),
    [qc]
  );

  return {
    dataSources,
    selectedDataSourceId: selectedId,
    dataSourceSchemas,
    getSelectedDataSource,
    selectDataSource: async (id: string | null) => {
      store.select(id);
      if (id && !store.schemaCache[id]) {
        await fetchDataSourceSchema(id);
      }
    },
    deleteDataSource: (id: string) => deleteMutation.mutateAsync(id),
    fetchDataSourceSchema,
    refreshDataSources,
    refreshSchemaForDataSource: fetchDataSourceSchema,
    isTestingConnection: false as boolean,
    schemaLoading: store.schemaLoading,
    isLoading,
  };
}
