import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import * as api from '@/api/dataSources';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  dataSourceKeys,
  isEnterpriseEdition,
  resolveDataSourceProjectId,
} from '@/hooks/dataSourceKeys';

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

// ── Composite hook — bridges React Query data + Zustand UI state ──────────────
// EE components import this via `useDataSources` from '@/stores/useDataSourceStore'.

export function useDataSources() {
  const selectedId = useDataSourceStore((state) => state.selectedId);
  const schemaCache = useDataSourceStore((state) => state.schemaCache);
  const setSelectedId = useDataSourceStore((state) => state.select);
  const setSchemaLoading = useDataSourceStore((state) => state.setSchemaLoading);
  const setSchemaCache = useDataSourceStore((state) => state.setSchemaCache);
  const schemaLoading = useDataSourceStore((state) => state.schemaLoading);
  const qc = useQueryClient();
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const effectiveProjectId = useMemo(
    () => resolveDataSourceProjectId(undefined, currentProjectId, false),
    [currentProjectId]
  );

  const { data, isLoading } = useQuery({
    queryKey: dataSourceKeys.list(effectiveProjectId ?? null),
    queryFn: () => api.listDataSources(effectiveProjectId),
    enabled: !isEnterpriseEdition || !!effectiveProjectId,
    select: (res) => res?.data_sources ?? [],
  });

  const dataSources: DataSource[] = data ?? [];

  // Auto-select a project data source when none is selected (or selection is stale after project switch).
  useEffect(() => {
    if (dataSources.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    const stillValid = selectedId && dataSources.some((ds) => ds.id === selectedId);
    if (stillValid) return;
    const preferred =
      dataSources.find((ds) => ds.connection_status === 'connected') ?? dataSources[0];
    if (preferred?.id) {
      setSelectedId(preferred.id);
    }
  }, [dataSources, selectedId, setSelectedId]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDataSource(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: dataSourceKeys.all }),
  });

  const fetchDataSourceSchema = useCallback(
    async (id: string) => {
      setSchemaLoading(true);
      try {
        const res = await api.getDataSourceSchema(id);
        setSchemaCache(id, res.schema);
      } finally {
        setSchemaLoading(false);
      }
    },
    [setSchemaLoading, setSchemaCache]
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
      qc.invalidateQueries({ queryKey: dataSourceKeys.all });
      if (!detail?.id) return;

      setSelectedId(detail.id);
      if (detail.schema) {
        setSchemaCache(detail.id, detail.schema as SchemaInfo);
      }
      fetchDataSourceSchema(detail.id).catch((error) => {
        console.error('Failed to load created data source schema:', error);
      });
    };

    window.addEventListener('datasource-created', handleDataSourceCreated);
    return () => window.removeEventListener('datasource-created', handleDataSourceCreated);
  }, [qc, setSelectedId, setSchemaCache, fetchDataSourceSchema]);

  const dataSourceSchemas = new Map<string, SchemaInfo>(Object.entries(schemaCache));

  const getSelectedDataSource = useCallback(
    () => dataSources.find((ds) => ds.id === selectedId) ?? null,
    [dataSources, selectedId]
  );

  const refreshDataSources = useCallback(
    () => qc.invalidateQueries({ queryKey: dataSourceKeys.all }),
    [qc]
  );

  return {
    dataSources,
    selectedDataSourceId: selectedId,
    dataSourceSchemas,
    getSelectedDataSource,
    selectDataSource: async (id: string | null) => {
      setSelectedId(id);
      if (id && !schemaCache[id]) {
        await fetchDataSourceSchema(id);
      }
    },
    deleteDataSource: (id: string) => deleteMutation.mutateAsync(id),
    fetchDataSourceSchema,
    refreshDataSources,
    refreshSchemaForDataSource: fetchDataSourceSchema,
    isTestingConnection: false as boolean,
    schemaLoading,
    isLoading,
  };
}
