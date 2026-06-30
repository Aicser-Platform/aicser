'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Spin, Empty } from 'antd';
import { useDataSources, useDataSourceSchema } from '@/hooks/useDataSources';
import { useRelationships } from '@/hooks/useDataModelRelationships';
import { createRelationship } from '@/api/dataModel';
import { ERDCanvas } from '../../ERDCanvas/ERDCanvas';
import type { DataModelRelationship } from '@/api/dataModel';

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
function useSingleFileSourceData(id: string) {
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
function FileSourceLoader({
  sourceId,
  sourceName,
  displayName,
  onLoaded,
}: {
  sourceId: string;
  sourceName: string;
  displayName: string;
  onLoaded: (
    sourceId: string,
    tables: { id: string; name: string; label: string; schema?: string; sourceId: string; columns: { name: string; type: string }[] }[],
    relationships: DataModelRelationship[]
  ) => void;
}) {
  const { schema, relationships, isLoading } = useSingleFileSourceData(sourceId);

  useEffect(() => {
    if (isLoading) return;
    const rawTables = (schema?.tables ?? []) as SchemaTable[];
    const tables = rawTables
      .map((table) => {
        const name = String(table.name || '').trim() || sourceName;
        const id = `${sourceId}__${name}`;
        // Multi-sheet sources (Excel): use the sheet name as the table label.
        // Single-sheet sources (CSV): fall back to the deduplicated data source name.
        const tableLabel = rawTables.length > 1 ? name : displayName;
        return {
          id,
          name: tableLabel,
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
  onConnectionCreate: (conn: {
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
  }) => void;
  selectedRelationshipId: string | null;
  onDataSourceChange?: (id: string) => void;
}

export function DataModelingSection({
  onRelationshipSelect,
  onConnectionCreate,
  selectedRelationshipId,
}: DataModelingSectionProps) {
  const { dataSources, isLoading: dsLoading } = useDataSources();

  // Separate file sources from DB/warehouse sources
  const fileSources = useMemo(
    () => dataSources.filter((ds) => ds.type === 'file'),
    [dataSources]
  );

  // Deduplicate display names for file sources
  const fileSourceDisplayNames = useMemo(() => {
    const names = fileSources.map((ds) => ds.name);
    const deduped = deduplicateNames(names);
    return Object.fromEntries(fileSources.map((ds, i) => [ds.id, deduped[i]]));
  }, [fileSources]);

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

  // Flatten all tables and relationships from all file sources
  const allTables = useMemo(() => {
    const result: { id: string; name: string; label: string; schema?: string; sourceId: string; columns: { name: string; type: string }[] }[] = [];
    loadedData.forEach(({ tables }) => result.push(...tables));
    return result;
  }, [loadedData]);

  const allRelationships = useMemo(() => {
    const result: DataModelRelationship[] = [];
    loadedData.forEach(({ relationships }) => result.push(...relationships));
    return result;
  }, [loadedData]);

  const isLoading = dsLoading || (fileSources.length > 0 && loadedData.size < fileSources.length);

  const handleConnectionCreate = async (conn: {
    fromTable: string;
    fromColumn: string;
    fromSourceId: string;
    toTable: string;
    toColumn: string;
    toSourceId: string;
  }) => {
    const toDataSourceId = conn.fromSourceId !== conn.toSourceId ? conn.toSourceId : undefined;
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
      to_data_source_id: toDataSourceId ?? null,
    });
    // Open the relationship details panel immediately after creation
    if (newRel?.id) {
      onRelationshipSelect(newRel);
    }
    // Also notify parent (non-async compatibility)
    onConnectionCreate({
      fromTable: conn.fromTable,
      fromColumn: conn.fromColumn,
      toTable: conn.toTable,
      toColumn: conn.toColumn,
    });
  };

  if (dsLoading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin size="small" />
      </div>
    );
  }

  if (fileSources.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No file-based data sources on this dashboard"
        style={{ padding: '24px 16px' }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Mount one FileSourceLoader per file source — each calls hooks for that source */}
      {fileSources.map((ds) => (
        <FileSourceLoader
          key={ds.id}
          sourceId={ds.id}
          sourceName={ds.name}
          displayName={fileSourceDisplayNames[ds.id]}
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
            description="No tables found in file sources"
            style={{ padding: '24px 16px' }}
          />
        ) : (
          <ERDCanvas
            dataSourceId="multi-file"
            tables={allTables}
            relationships={allRelationships}
            onRelationshipSelect={onRelationshipSelect}
            onConnectionCreate={handleConnectionCreate}
            selectedRelationshipId={selectedRelationshipId}
          />
        )}
      </div>
    </div>
  );
}
