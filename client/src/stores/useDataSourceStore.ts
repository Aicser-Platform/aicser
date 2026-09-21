import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import * as api from '@/api/dataSources';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  dataSourceKeys,
  isEnterpriseEdition,
  resolveDataSourceProjectId,
} from '@/hooks/dataSourceKeys';

const CHAT_DS_PREF_KEY = 'userPreferences';

export function getStoredDataSourcePreference(): { id: string | null; explicitlyCleared: boolean } {
  if (typeof window === 'undefined') return { id: null, explicitlyCleared: false };
  try {
    const raw = localStorage.getItem(CHAT_DS_PREF_KEY);
    if (!raw) return { id: null, explicitlyCleared: false };
    const prefs = JSON.parse(raw);
    if (!prefs || typeof prefs !== 'object') return { id: null, explicitlyCleared: false };
    return {
      id: typeof prefs.dataSourceId === 'string' && prefs.dataSourceId.trim() ? prefs.dataSourceId.trim() : null,
      explicitlyCleared: prefs.explicitlyClearedDataSource === true,
    };
  } catch {
    return { id: null, explicitlyCleared: false };
  }
}

export function persistSelectedDataSourceId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(CHAT_DS_PREF_KEY);
    const prefs = raw ? JSON.parse(raw) : {};
    if (!prefs || typeof prefs !== 'object') return;
    if (id && typeof id === 'string' && id.trim()) {
      prefs.dataSourceId = id.trim();
      prefs.explicitlyClearedDataSource = false;
    } else {
      delete prefs.dataSourceId;
      prefs.explicitlyClearedDataSource = true;
    }
    localStorage.setItem(CHAT_DS_PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

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
  /** True right after the user explicitly cleared the selection (the
   * dropdown's own X button) — distinct from selectedId being null just
   * because nothing has loaded/selected yet. The auto-select-first effect
   * below needs this distinction: it's supposed to heal a stale/invalid
   * selection (e.g. after a project switch), not immediately undo a
   * deliberate "I want no source selected right now" action, which is
   * indistinguishable from a stale selection by selectedId alone. */
  explicitlyCleared: boolean;
  filterType: string | null;
  schemaCache: Record<string, SchemaInfo>;
  schemaLoading: boolean;
  select: (id: string | null) => void;
  setFilter: (type: string | null) => void;
  setSchemaCache: (id: string, schema: SchemaInfo) => void;
  setSchemaLoading: (loading: boolean) => void;
}

const initialPref = getStoredDataSourcePreference();

export const useDataSourceStore = create<DataSourceUIState>()(
  devtools(
    persist(
      (set) => ({
        selectedId: initialPref.explicitlyCleared ? null : initialPref.id,
        explicitlyCleared: initialPref.explicitlyCleared,
        filterType: null,
        schemaCache: {},
        schemaLoading: false,
        select: (id) => {
          persistSelectedDataSourceId(id);
          set({ selectedId: id, explicitlyCleared: id === null });
        },
        setFilter: (type) => set({ filterType: type }),
        setSchemaCache: (id, schema) =>
          set((s) => ({ schemaCache: { ...s.schemaCache, [id]: schema } })),
        setSchemaLoading: (loading) => set({ schemaLoading: loading }),
      }),
      {
        name: 'datasource-ui-storage',
        partialize: (state) => ({
          selectedId: state.selectedId,
          explicitlyCleared: state.explicitlyCleared,
        }),
      }
    ),
    { name: 'DataSourceStore' }
  )
);

// ── Composite hook — bridges React Query data + Zustand UI state ──────────────
// EE components import this via `useDataSources` from '@/stores/useDataSourceStore'.

export function useDataSources() {
  const selectedId = useDataSourceStore((state) => state.selectedId);
  const explicitlyCleared = useDataSourceStore((state) => state.explicitlyCleared);
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
  // Skipped right after the user explicitly cleared the selection (persisted across refreshes) —
  // otherwise this effect re-fires on the very next render or refresh (selectedId just went null)
  // and immediately re-selects the first source, making the clear button a no-op across refreshes.
  useEffect(() => {
    if (dataSources.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    const storedPref = getStoredDataSourcePreference();
    if (explicitlyCleared || storedPref.explicitlyCleared) return;
    const stillValid = selectedId && dataSources.some((ds) => ds.id === selectedId);
    if (stillValid) return;
    if (storedPref.id && dataSources.some((ds) => ds.id === storedPref.id)) {
      setSelectedId(storedPref.id);
      return;
    }
    const preferred =
      dataSources.find((ds) => ds.connection_status === 'connected') ?? dataSources[0];
    if (preferred?.id) {
      setSelectedId(preferred.id);
    }
  }, [dataSources, selectedId, explicitlyCleared, setSelectedId]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDataSource(id),
    onSuccess: (_, deletedId) => {
      qc.invalidateQueries({ queryKey: dataSourceKeys.all });
      if (selectedId === deletedId) {
        setSelectedId(null);
        persistSelectedDataSourceId(null);
      }
    },
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
      persistSelectedDataSourceId(detail.id);
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
      persistSelectedDataSourceId(id);
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
