'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Select, Spin, Empty, message, Typography, Button, Switch, Tooltip, Collapse } from 'antd';
import { useTranslations } from 'next-intl';
import { ExportOutlined, InfoCircleOutlined } from '@ant-design/icons';
import './DataModelWorkbenchPanel.css';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useDataSources, useDataSourceSchema } from '@/hooks/useDataSources';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { useRelationships, useAutoDetectRelationships } from '@/hooks/useDataModelRelationships';
import { createRelationship, type DataModelRelationship } from '@/api/dataModel';
import { ERDCanvas } from '@/app/(dashboard)/dashboards/components/ERDCanvas/ERDCanvas';
import { DataModelRelationships } from '@/components/data/DataModelRelationships';
import { semanticLayerStudioHref } from '@/app/(dashboard)/data/sources/[id]/_components/tabParam';
import { isModelEligibleDataSource } from '@/components/data/modelEligible';

const { Text } = Typography;

function typeFamily(type: string): 'number' | 'date' | 'bool' | 'text' | 'unknown' {
  const t = type.toUpperCase();
  if (/INT|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL|NUMBER/.test(t)) return 'number';
  if (/DATE|TIME/.test(t)) return 'date';
  if (/BOOL/.test(t)) return 'bool';
  if (/CHAR|TEXT|STRING|UUID/.test(t)) return 'text';
  return 'unknown';
}

type SchemaTable = {
  name?: string;
  schema?: string;
  columns?: Array<{ name?: string; type?: string } | string>;
};

export type WorkbenchTable = {
  id: string;
  name: string;
  label: string;
  schema?: string;
  sourceId: string;
  columns: { name: string; type: string }[];
};

const EMPTY_RELATIONSHIPS: DataModelRelationship[] = [];

function deduplicateNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}_${count}`;
  });
}

/** Canvas title: prefix source only when the table name differs (avoids "Sheet · Sheet"). */
function erdTableLabel(
  displayName: string,
  schemaLabel: string,
  multiSource: boolean,
  preferSourceNameForSingleTable: boolean,
  singleTableInSource: boolean,
): string {
  const base =
    singleTableInSource && preferSourceNameForSingleTable ? displayName : schemaLabel;
  if (!multiSource) return base;
  const norm = (s: string) => s.trim().toLowerCase();
  if (norm(base) === norm(displayName)) return displayName;
  return `${displayName} · ${base}`;
}

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

function DataSourceModelLoader({
  sourceId,
  sourceName,
  displayName,
  preferSourceNameForSingleTable,
  multiSource,
  onLoaded,
}: {
  sourceId: string;
  sourceName: string;
  displayName: string;
  preferSourceNameForSingleTable: boolean;
  multiSource: boolean;
  onLoaded: (
    sourceId: string,
    tables: WorkbenchTable[],
    relationships: DataModelRelationship[],
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
        const schemaLabel =
          table.schema && table.schema !== 'public' ? `${table.schema}.${name}` : name;
        const tableLabel = erdTableLabel(
          displayName,
          schemaLabel,
          multiSource,
          preferSourceNameForSingleTable,
          rawTables.length === 1,
        );
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
  }, [schema, relationships, isLoading, multiSource, displayName]);

  return null;
}

export type DataModelWorkbenchPanelProps = {
  /** Host source for auto-detect and default join ownership. */
  primarySourceId?: string | null;
  /** `project` loads every model-eligible source in the project; `single` only the primary. */
  scope?: 'project' | 'single';
  /** Let authors expand the canvas to all sources in the project (semantic layer default). */
  showProjectScopeToggle?: boolean;
  /** When the project canvas toggle is shown, start with all project sources visible. */
  defaultProjectCanvas?: boolean;
  onRelationshipSelect?: (rel: DataModelRelationship | null) => void;
  selectedRelationshipId?: string | null;
  /** Sidebar (dashboard studio) vs embedded (semantic tab / drawer). */
  variant?: 'sidebar' | 'embedded';
  /** Min height for the ERD canvas area. */
  canvasMinHeight?: number;
  /** Show relationship table editor below the canvas. */
  showRelationshipTable?: boolean;
  onRelationshipsChanged?: () => void;
  /** Hide redundant link back to semantic tab when already embedded there. */
  hideSemanticNavLink?: boolean;
};

export function DataModelWorkbenchPanel({
  primarySourceId: primarySourceIdProp,
  scope = 'project',
  showProjectScopeToggle = false,
  defaultProjectCanvas = false,
  hideSemanticNavLink = false,
  onRelationshipSelect,
  selectedRelationshipId = null,
  variant = 'sidebar',
  canvasMinHeight = 420,
  showRelationshipTable = false,
  onRelationshipsChanged,
}: DataModelWorkbenchPanelProps) {
  const t = useTranslations('dashboards_page');
  const [projectCanvas, setProjectCanvas] = useState(
    scope === 'project' || (showProjectScopeToggle && defaultProjectCanvas),
  );
  const [canvasSourceIds, setCanvasSourceIds] = useState<string[]>([]);
  const [localSelectedRelId, setLocalSelectedRelId] = useState<string | null>(null);
  const effectiveSelectedRelId = selectedRelationshipId ?? localSelectedRelId;
  const handleRelationshipSelect = useCallback(
    (rel: DataModelRelationship | null) => {
      setLocalSelectedRelId(rel?.id ?? null);
      onRelationshipSelect?.(rel);
    },
    [onRelationshipSelect],
  );
  const effectiveScope: 'project' | 'single' =
    showProjectScopeToggle ? (projectCanvas ? 'project' : 'single') : scope;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { dataSources, isLoading: dsLoading } = useDataSources();
  const globalSelectedId = useDataSourceStore((s) => s.selectedId);
  const selectGlobalDataSource = useDataSourceStore((s) => s.select);

  const eligibleSources = useMemo(
    () => dataSources.filter((ds) => isModelEligibleDataSource(ds.type)),
    [dataSources],
  );

  const [primarySourceId, setPrimarySourceIdState] = useState<string | null>(
    primarySourceIdProp ?? globalSelectedId,
  );

  const setPrimarySourceId = (id: string | null) => {
    setPrimarySourceIdState(id);
    if (variant === 'sidebar') {
      selectGlobalDataSource(id);
    }
  };

  useEffect(() => {
    if (primarySourceIdProp) {
      setPrimarySourceIdState(primarySourceIdProp);
    }
  }, [primarySourceIdProp]);

  useEffect(() => {
    if (primarySourceIdProp) return;
    if (globalSelectedId && globalSelectedId !== primarySourceId && eligibleSources.some((s) => s.id === globalSelectedId)) {
      setPrimarySourceIdState(globalSelectedId);
    }
  }, [globalSelectedId, eligibleSources, primarySourceId, primarySourceIdProp]);

  useEffect(() => {
    if (!eligibleSources.length) {
      setPrimarySourceId(null);
      return;
    }
    if (!primarySourceId || !eligibleSources.some((s) => s.id === primarySourceId)) {
      setPrimarySourceId(eligibleSources[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primarySourceId, eligibleSources]);

  useEffect(() => {
    if (!showProjectScopeToggle) {
      setProjectCanvas(scope === 'project');
    }
  }, [scope, showProjectScopeToggle]);

  useEffect(() => {
    if (effectiveScope !== 'project') return;
    setCanvasSourceIds((prev) => {
      const valid = prev.filter((id) => eligibleSources.some((s) => s.id === id));
      if (valid.length > 0) return valid;
      return eligibleSources.map((s) => s.id);
    });
  }, [effectiveScope, eligibleSources]);

  const modelSources = useMemo(() => {
    if (effectiveScope === 'single' && primarySourceId) {
      const one = eligibleSources.find((s) => s.id === primarySourceId);
      return one ? [one] : [];
    }
    const ids = canvasSourceIds.length ? canvasSourceIds : eligibleSources.map((s) => s.id);
    return eligibleSources.filter((s) => ids.includes(s.id));
  }, [effectiveScope, primarySourceId, eligibleSources, canvasSourceIds]);

  const multiSource = modelSources.length > 1;

  const sourceDisplayNames = useMemo(() => {
    const names = modelSources.map((ds) => ds.name);
    const deduped = deduplicateNames(names);
    return Object.fromEntries(modelSources.map((ds, i) => [ds.id, deduped[i]]));
  }, [modelSources]);

  const [loadedData, setLoadedData] = useState<
    Map<string, { tables: WorkbenchTable[]; relationships: DataModelRelationship[] }>
  >(new Map());

  const handleSourceLoaded = useCallback(
    (
      sourceId: string,
      tables: WorkbenchTable[],
      relationships: DataModelRelationship[],
    ) => {
      setLoadedData((prev) => {
        const next = new Map(prev);
        next.set(sourceId, { tables, relationships });
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const ids = new Set(modelSources.map((s) => s.id));
    setLoadedData((prev) => {
      let changed = false;
      const next = new Map(prev);
      next.forEach((_v, sourceId) => {
        if (!ids.has(sourceId)) {
          next.delete(sourceId);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [modelSources]);

  const allTables = useMemo(() => {
    const out: WorkbenchTable[] = [];
    for (const ds of modelSources) {
      out.push(...(loadedData.get(ds.id)?.tables ?? []));
    }
    return out;
  }, [modelSources, loadedData]);

  const allRelationships = useMemo(() => {
    const seen = new Set<string>();
    const out: DataModelRelationship[] = [];
    for (const ds of modelSources) {
      for (const rel of loadedData.get(ds.id)?.relationships ?? []) {
        if (!seen.has(rel.id)) {
          seen.add(rel.id);
          out.push(rel);
        }
      }
    }
    return out;
  }, [modelSources, loadedData]);

  const isLoading =
    dsLoading ||
    modelSources.some((ds) => !loadedData.has(ds.id));

  const pendingKeys = React.useRef<Set<string>>(new Set());
  const autoDetectMutation = useAutoDetectRelationships(primarySourceId ?? '');
  const autoDetectAttempted = React.useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!primarySourceId || isLoading || effectiveScope !== 'single') return;
    if (autoDetectAttempted.current.has(primarySourceId)) return;
    if (allTables.length === 0 || allRelationships.length > 0) return;
    autoDetectAttempted.current.add(primarySourceId);
    autoDetectMutation.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primarySourceId, isLoading, allTables.length, allRelationships.length, effectiveScope]);

  const handleDetectRelationships = useCallback(() => {
    if (!primarySourceId) return;
    autoDetectAttempted.current.add(primarySourceId);
    const projectSourceIds = modelSources.map((s) => s.id);
    autoDetectMutation.mutate(
      effectiveScope === 'project' && projectSourceIds.length > 1
        ? { projectSourceIds }
        : undefined,
      {
        onSuccess: (result) => {
          const added = result.totalAdded ?? result.relationships.length;
          if (added > 0) {
            message.success(t('modeling_relationships_detected', { count: added }));
          } else {
            message.info(t('modeling_no_relationships_detected'));
          }
          onRelationshipsChanged?.();
        },
        onError: () => message.error(t('modeling_detect_failed')),
      },
    );
  }, [primarySourceId, autoDetectMutation, effectiveScope, modelSources, t, onRelationshipsChanged]);

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
      const hostSourceId = conn.fromSourceId;
      if (
        conn.fromSourceId === conn.toSourceId &&
        conn.fromTable === conn.toTable &&
        conn.fromColumn === conn.toColumn
      ) {
        return;
      }

      const alreadyExists = allRelationships.some(
        (r) =>
          r.data_source_id === hostSourceId &&
          ((r.from_table === conn.fromTable &&
            r.from_column === conn.fromColumn &&
            r.to_table === conn.toTable &&
            r.to_column === conn.toColumn &&
            (r.to_data_source_id || hostSourceId) ===
              (conn.toSourceId !== conn.fromSourceId ? conn.toSourceId : hostSourceId)) ||
            (r.from_table === conn.toTable &&
              r.from_column === conn.toColumn &&
              r.to_table === conn.fromTable &&
              r.to_column === conn.fromColumn)),
      );
      if (alreadyExists) return;

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

      const crossSource = conn.fromSourceId !== conn.toSourceId;

      try {
        const newRel = await createRelationship(hostSourceId, {
          from_table: conn.fromTable,
          from_column: conn.fromColumn,
          to_table: conn.toTable,
          to_column: conn.toColumn,
          join_type: 'LEFT',
          cardinality: 'one_to_many',
          cross_filter_direction: 'single',
          is_active: true,
          assume_integrity: false,
          to_data_source_id: crossSource ? conn.toSourceId : null,
        });
        await queryClient.invalidateQueries({
          queryKey: ['data-model-relationships', hostSourceId],
        });
        if (crossSource) {
          await queryClient.invalidateQueries({
            queryKey: ['data-model-relationships', conn.toSourceId],
          });
        }
        handleRelationshipSelect(newRel?.id ? newRel : null);
        message.success(
          crossSource ? t('modeling_connection_created_cross') : t('modeling_connection_created'),
        );
        onRelationshipsChanged?.();
      } finally {
        pendingKeys.current.delete(key);
      }
    },
    [allRelationships, columnType, handleRelationshipSelect, queryClient, t, onRelationshipsChanged],
  );

  const joinListRelationships = useMemo(() => {
    if (!primarySourceId) return [];
    return allRelationships.filter(
      (r) =>
        r.data_source_id === primarySourceId ||
        (r.to_data_source_id && r.to_data_source_id === primarySourceId),
    );
  }, [allRelationships, primarySourceId]);

  if (dsLoading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin size="small" />
      </div>
    );
  }

  if (!eligibleSources.length) {
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

  const compactEmbedded = variant === 'embedded' && hideSemanticNavLink;
  const toolbarPadding = variant === 'sidebar' ? '8px 12px' : '0 0 8px';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: variant === 'sidebar' || compactEmbedded ? 1 : undefined,
        minHeight: 0,
        gap: showRelationshipTable ? (compactEmbedded ? 6 : 16) : 0,
      }}
    >
      <div style={{ padding: toolbarPadding, borderBottom: variant === 'sidebar' ? '1px solid var(--ant-color-border)' : undefined }}>
        {/* One row: which sources, all of them or not, and the rest in a tooltip or an icon. */}
        <div className="data-model-toolbar">
          {effectiveScope === 'project' ? (
            <Select
              mode="multiple"
              size="small"
              allowClear
              maxTagCount="responsive"
              placeholder={t('modeling_select_sources')}
              value={canvasSourceIds}
              onChange={(ids) => {
                setCanvasSourceIds(ids);
                handleRelationshipSelect(null);
                if (ids.length === 1) setPrimarySourceId(ids[0]);
                else if (ids.length > 1 && primarySourceId && !ids.includes(primarySourceId)) {
                  setPrimarySourceId(ids[0]);
                }
              }}
              options={eligibleSources.map((source) => ({ value: source.id, label: source.name }))}
              style={{ minWidth: 180, flex: 1 }}
              aria-label={t('modeling_select_sources')}
            />
          ) : (
            <Select
              size="small"
              value={primarySourceId ?? undefined}
              onChange={(id) => {
                setPrimarySourceId(id);
                handleRelationshipSelect(null);
              }}
              options={eligibleSources.map((source) => ({ value: source.id, label: source.name }))}
              style={{ minWidth: 160, flex: 1 }}
              aria-label={t('modeling_select_sources')}
            />
          )}
          {showProjectScopeToggle ? (
            <label className="data-model-toolbar__switch">
              <Switch
                size="small"
                checked={projectCanvas}
                onChange={(on) => {
                  setProjectCanvas(on);
                  if (on && canvasSourceIds.length === 0) {
                    setCanvasSourceIds(eligibleSources.map((s) => s.id));
                  }
                }}
                aria-label={t('modeling_project_canvas_toggle')}
              />
              <Text type="secondary">{t('modeling_all_sources')}</Text>
            </label>
          ) : null}
          <Tooltip
            title={
              <span>
                {t('modeling_focus_source_hint')}
                {effectiveScope === 'project' && multiSource ? <><br />{t('modeling_project_canvas', { count: modelSources.length })}</> : null}
              </span>
            }
          >
            <InfoCircleOutlined className="data-model-toolbar__info" aria-label={t('modeling_focus_source_hint')} />
          </Tooltip>
          {primarySourceId && !hideSemanticNavLink ? (
            <Tooltip title={t('open_semantic_layer_full')}>
              <Button size="small" type="text" icon={<ExportOutlined />} aria-label={t('open_semantic_layer_full')}
                onClick={() => router.push(semanticLayerStudioHref(primarySourceId, 'joins'))} />
            </Tooltip>
          ) : null}
        </div>
      </div>

      {modelSources.map((ds) => (
        <DataSourceModelLoader
          key={ds.id}
          sourceId={ds.id}
          sourceName={ds.name}
          displayName={sourceDisplayNames[ds.id]}
          preferSourceNameForSingleTable={ds.type === 'file'}
          multiSource={multiSource}
          onLoaded={handleSourceLoaded}
        />
      ))}

      <div
        style={{
          flex: 1,
          minHeight: canvasMinHeight,
          position: 'relative',
          ...(compactEmbedded ? { display: 'flex', flexDirection: 'column' } : {}),
        }}
      >
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
            dataSourceId={primarySourceId ?? 'no-source'}
            tables={allTables}
            relationships={allRelationships}
            onRelationshipSelect={handleRelationshipSelect}
            onConnectionCreate={handleConnectionCreate}
            selectedRelationshipId={effectiveSelectedRelId}
            onDetectRelationships={handleDetectRelationships}
            isDetectingRelationships={autoDetectMutation.isPending}
            compactToolbar={compactEmbedded}
            onRelationshipsChanged={onRelationshipsChanged}
          />
        )}
      </div>

      {showRelationshipTable && primarySourceId ? (
        compactEmbedded ? (
          <Collapse
            size="small"
            bordered={false}
            defaultActiveKey={['joins']}
            className="data-model-workbench__join-collapse"
            items={[
              {
                key: 'joins',
                label: `${t('data_model_join_list')} (${joinListRelationships.length})`,
                children: (
                  <DataModelRelationships
                    dataSourceId={primarySourceId}
                    compact
                    relationships={joinListRelationships}
                    sourceLabelById={Object.fromEntries(eligibleSources.map((ds) => [ds.id, ds.name]))}
                    onChanged={onRelationshipsChanged}
                  />
                ),
              },
            ]}
          />
        ) : (
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('data_model_join_list')}
            </Text>
            <DataModelRelationships
              dataSourceId={primarySourceId}
              compact
              relationships={joinListRelationships}
              sourceLabelById={Object.fromEntries(eligibleSources.map((ds) => [ds.id, ds.name]))}
              onChanged={onRelationshipsChanged}
            />
          </div>
        )
      ) : null}
    </div>
  );
}
