'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Select, Spin, Empty, message, Typography, Button } from 'antd';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useDataSources, useDataSourceSchema } from '@/hooks/useDataSources';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { useRelationships, useAutoDetectRelationships } from '@/hooks/useDataModelRelationships';
import { createRelationship } from '@/api/dataModel';
import { ERDCanvas } from '../../ERDCanvas/ERDCanvas';
import type { DataModelRelationship } from '@/api/dataModel';

const { Text } = Typography;

// Coarse SQL type family — two columns can only be joined when they share one.
function typeFamily(type: string): 'number' | 'date' | 'bool' | 'text' | 'unknown' {
  const t = type.toUpperCase();
  if (/INT|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL|NUMBER/.test(t)) return 'number';
  if (/DATE|TIME/.test(t)) return 'date';
  if (/BOOL/.test(t)) return 'bool';
  if (/CHAR|TEXT|STRING|UUID/.test(t)) return 'text';
  return 'unknown';
}

type SchemaColumn = {
  name?: string;
  type?: string;
};

type SchemaTable = {
  name?: string;
  schema?: string;
  columns?: Array<SchemaColumn | string>;
};

// Deduplicate table display names across sources — appends _2, _3 on collision
function deduplicateNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}_${count}`;
  });
}

// Stable empty array — avoids new reference on every render when query has no data yet
const EMPTY_RELATIONSHIPS: DataModelRelationship[] = [];

// Hook: load schema for one data source; returns null while loading or on error
function useSingleDataSourceModel(id: string) {
  const { schema, isLoading: schemaLoading, error: schemaError } = useDataSourceSchema(id);
  const { data: relationships, isLoading: relsLoading, error: relsError } = useRelationships(id);
  return {
    schema,
    relationships: relationships ?? EMPTY_RELATIONSHIPS,
    isLoading: schemaLoading || relsLoading,
    error: schemaError || relsError,
  };
}

// Sub-component: loads one source and contributes its tables + relationships upward via callbacks
// (Hooks cannot be called conditionally, so we extract per-source loading to a component)
function DataSourceModelLoader({
  sourceId,
  sourceName,
  displayName,
  preferSourceNameForSingleTable,
  onLoaded,
}: {
  sourceId: string;
  sourceName: string;
  displayName: string;
  preferSourceNameForSingleTable: boolean;
  onLoaded: (
    sourceId: string,
    tables: { id: string; name: string; label: string; schema?: string; sourceId: string; columns: { name: string; type: string }[] }[],
    relationships: DataModelRelationship[]
  ) => void;
}) {
  const { schema, relationships, isLoading } = useSingleDataSourceModel(sourceId);

  useEffect(() => {
    if (isLoading) return;
    const rawTables = (schema?.tables ?? []) as SchemaTable[];
    const tables = rawTables
      .map((table) => {
        const name = String(table.name || '').trim() || sourceName;
        const id = `${sourceId}__${name}`;
        const schemaLabel = table.schema && table.schema !== 'public' ? `${table.schema}.${name}` : name;
        const tableLabel = rawTables.length === 1 && preferSourceNameForSingleTable ? displayName : schemaLabel;
        return {
          id,
          name,
          label: tableLabel,
          schema: table.schema,
          sourceId,
          columns: (table.columns ?? [])
            .map((col) => {
              if (typeof col === 'string') return { name: col, type: 'string' };
              const colName = String(col?.name || '').trim();
              if (!colName) return null;
              return { name: colName, type: String(col?.type || 'string') };
            })
            .filter((c): c is { name: string; type: string } => Boolean(c)),
        };
      });
    onLoaded(sourceId, tables, relationships);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, relationships, isLoading]);

  return null;
}

export interface DataModelingSectionProps {
  onRelationshipSelect: (rel: DataModelRelationship | null) => void;
  selectedRelationshipId: string | null;
}

export function DataModelingSection({
  onRelationshipSelect,
  selectedRelationshipId,
}: DataModelingSectionProps) {
  const t = useTranslations('dashboards_page');
  const queryClient = useQueryClient();
  const { dataSources, isLoading: dsLoading } = useDataSources();
  // Shared with the Data tab (DataSection.tsx) via the same global store,
  // instead of its own disconnected local selection - previously switching
  // the source here had no effect on Data and vice versa, despite both
  // being "about my data" one click apart in the same sidebar.
  const globalSelectedId = useDataSourceStore((s) => s.selectedId);
  const selectGlobalDataSource = useDataSourceStore((s) => s.select);
  const [activeSourceId, setActiveSourceIdState] = useState<string | null>(globalSelectedId);
  const setActiveSourceId = (id: string | null) => {
    setActiveSourceIdState(id);
    selectGlobalDataSource(id);
  };
  // Keys of creates currently in flight — prevents the ERD firing the same
  // connection twice (drag + click) from issuing two POSTs.
  const pendingKeys = React.useRef<Set<string>>(new Set());
  const autoDetectMutation = useAutoDetectRelationships(activeSourceId ?? '');
  // Sources we've already auto-run detection for — so the background pass
  // fires once per source per session, not on every relationships refetch.
  const autoDetectAttempted = React.useRef<Set<string>>(new Set());

  // Pick up a source selected elsewhere (e.g. the Data tab) when this tab
  // becomes active, as long as it's still a valid source.
  useEffect(() => {
    if (globalSelectedId && globalSelectedId !== activeSourceId && dataSources.some((s) => s.id === globalSelectedId)) {
      setActiveSourceIdState(globalSelectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSelectedId, dataSources]);

  useEffect(() => {
    if (!dataSources.length) {
      setActiveSourceId(null);
      return;
    }
    if (!activeSourceId || !dataSources.some((source) => source.id === activeSourceId)) {
      setActiveSourceId(dataSources[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSourceId, dataSources]);

  const selectedSource = useMemo(
    () => dataSources.find((source) => source.id === activeSourceId) ?? null,
    [activeSourceId, dataSources],
  );
  const modelSources = useMemo(() => (selectedSource ? [selectedSource] : []), [selectedSource]);

  const sourceDisplayNames = useMemo(() => {
    const names = modelSources.map((ds) => ds.name);
    const deduped = deduplicateNames(names);
    return Object.fromEntries(modelSources.map((ds, i) => [ds.id, deduped[i]]));
  }, [modelSources]);

  // Aggregated state: sourceId → { tables, relationships }
  const [loadedData, setLoadedData] = useState<
    Map<string, {
      tables: { id: string; name: string; label: string; schema?: string; sourceId: string; columns: { name: string; type: string }[] }[];
      relationships: DataModelRelationship[];
    }>
  >(new Map());

  const handleSourceLoaded = (
    sourceId: string,
    tables: { id: string; name: string; label: string; schema?: string; sourceId: string; columns: { name: string; type: string }[] }[],
    relationships: DataModelRelationship[]
  ) => {
    setLoadedData((prev) => {
      const next = new Map(prev);
      next.set(sourceId, { tables, relationships });
      return next;
    });
  };

  useEffect(() => {
    const ids = new Set(modelSources.map((source) => source.id));
    setLoadedData((prev) => {
      let changed = false;
      const next = new Map(prev);
      next.forEach((_value, sourceId) => {
        if (!ids.has(sourceId)) {
          next.delete(sourceId);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [modelSources]);

  const allTables = useMemo(() => {
    if (!activeSourceId) return [];
    return loadedData.get(activeSourceId)?.tables ?? [];
  }, [activeSourceId, loadedData]);

  const allRelationships = useMemo(() => {
    if (!activeSourceId) return [];
    return loadedData.get(activeSourceId)?.relationships ?? [];
  }, [activeSourceId, loadedData]);

  const isLoading = dsLoading || Boolean(activeSourceId && !loadedData.has(activeSourceId));

  // First time a source's model has real tables but no relationships yet
  // (a fresh connection, or one nobody has modeled before), silently run FK
  // + shared-key detection once so the canvas doesn't open to a wall of
  // disconnected tables. Manual "Detect relationships" (below) covers
  // re-running it later, or a schema that genuinely has no relationships.
  useEffect(() => {
    if (!activeSourceId || isLoading) return;
    if (autoDetectAttempted.current.has(activeSourceId)) return;
    if (allTables.length === 0 || allRelationships.length > 0) return;
    autoDetectAttempted.current.add(activeSourceId);
    autoDetectMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSourceId, isLoading, allTables.length, allRelationships.length]);

  const handleDetectRelationships = useCallback(() => {
    if (!activeSourceId) return;
    autoDetectAttempted.current.add(activeSourceId);
    autoDetectMutation.mutate(undefined, {
      onSuccess: (rels) => {
        if (rels.length > 0) {
          message.success(t('modeling_relationships_detected', { count: rels.length }));
        } else {
          message.info(t('modeling_no_relationships_detected'));
        }
      },
      onError: () => {
        message.error(t('modeling_detect_failed'));
      },
    });
  }, [activeSourceId, autoDetectMutation, t]);

  const columnType = useCallback(
    (sourceId: string, tableName: string, columnName: string): string | undefined => {
      const table = allTables.find((tb) => tb.sourceId === sourceId && tb.name === tableName);
      return table?.columns.find((c) => c.name === columnName)?.type;
    },
    [allTables],
  );

  const handleConnectionCreate = useCallback(
    async (conn: {
      fromTable: string;
      fromColumn: string;
      fromSourceId: string;
      toTable: string;
      toColumn: string;
      toSourceId: string;
    }) => {
      if (!activeSourceId) return;
      if (conn.fromSourceId !== activeSourceId || conn.toSourceId !== activeSourceId) {
        message.warning(t('modeling_same_source_only'));
        return;
      }

      // Ignore a column joined to itself.
      if (
        conn.fromSourceId === conn.toSourceId &&
        conn.fromTable === conn.toTable &&
        conn.fromColumn === conn.toColumn
      ) {
        return;
      }

      // Skip if this relationship already exists (either direction).
      const alreadyExists = allRelationships.some(
        (r) =>
          (r.from_table === conn.fromTable &&
            r.from_column === conn.fromColumn &&
            r.to_table === conn.toTable &&
            r.to_column === conn.toColumn) ||
          (r.from_table === conn.toTable &&
            r.from_column === conn.toColumn &&
            r.to_table === conn.fromTable &&
            r.to_column === conn.fromColumn),
      );
      if (alreadyExists) return;

      // Reject joins between incompatible column types (e.g. an INT key joined
      // to a TEXT column) — these produce a hard SQL conversion error at query
      // time and break every chart that uses the model.
      const fromType = columnType(conn.fromSourceId, conn.fromTable, conn.fromColumn);
      const toType = columnType(conn.toSourceId, conn.toTable, conn.toColumn);
      if (fromType && toType) {
        const a = typeFamily(fromType);
        const b = typeFamily(toType);
        if (a !== 'unknown' && b !== 'unknown' && a !== b) {
          message.warning(t('modeling_incompatible_join'));
          return;
        }
      }

      const key = `${conn.fromSourceId}:${conn.fromTable}.${conn.fromColumn}->${conn.toSourceId}:${conn.toTable}.${conn.toColumn}`;
      if (pendingKeys.current.has(key)) return;
      pendingKeys.current.add(key);

      try {
        const newRel = await createRelationship(conn.fromSourceId, {
          from_table: conn.fromTable,
          from_column: conn.fromColumn,
          to_table: conn.toTable,
          to_column: conn.toColumn,
          join_type: 'LEFT',
          cardinality: 'one_to_many',
          cross_filter_direction: 'single',
          is_active: true,
          assume_integrity: false,
          to_data_source_id: null,
        });
        // Refresh the cached relationships so the new edge appears immediately.
        await queryClient.invalidateQueries({
          queryKey: ['data-model-relationships', conn.fromSourceId],
        });
        // Open the relationship details panel immediately after creation.
        if (newRel?.id) {
          onRelationshipSelect(newRel);
        }
        // The only other feedback on a successful connect is the edge itself
        // appearing on the canvas — easy to miss on a busy diagram, so say
        // it out loud too.
        message.success(t('modeling_connection_created'));
      } finally {
        pendingKeys.current.delete(key);
      }
    },
    [activeSourceId, allRelationships, columnType, onRelationshipSelect, queryClient, t],
  );

  if (dsLoading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin size="small" />
      </div>
    );
  }

  if (modelSources.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('modeling_no_sources')}
        style={{ padding: '24px 16px' }}
      >
        <Button
          type="primary"
          size="small"
          onClick={() => window.dispatchEvent(new CustomEvent('aiser-open-data-source-modal'))}
        >
          {t('data_connect_source_cta')}
        </Button>
      </Empty>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ant-color-border)' }}>
        <Text className="data-workbench-kicker">{t('data_source')}</Text>
        <Select
          size="small"
          value={activeSourceId ?? undefined}
          onChange={(id) => {
            setActiveSourceId(id);
            onRelationshipSelect(null);
          }}
          options={dataSources.map((source) => ({ value: source.id, label: source.name }))}
          style={{ width: '100%', marginTop: 8 }}
        />
      </div>
      {modelSources.map((ds) => (
        <DataSourceModelLoader
          key={ds.id}
          sourceId={ds.id}
          sourceName={ds.name}
          displayName={sourceDisplayNames[ds.id]}
          preferSourceNameForSingleTable={ds.type === 'file'}
          onLoaded={handleSourceLoaded}
        />
      ))}

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {isLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spin size="small" />
          </div>
        ) : allTables.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('modeling_no_tables')}
            style={{ padding: '24px 16px' }}
          />
        ) : (
          <ERDCanvas
            dataSourceId={activeSourceId ?? 'no-source'}
            tables={allTables}
            relationships={allRelationships}
            onRelationshipSelect={onRelationshipSelect}
            onConnectionCreate={handleConnectionCreate}
            selectedRelationshipId={selectedRelationshipId}
            onDetectRelationships={handleDetectRelationships}
            isDetectingRelationships={autoDetectMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}
