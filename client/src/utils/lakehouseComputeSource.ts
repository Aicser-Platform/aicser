import type { DataSource } from '@/stores/useDataSourceStore';

/** Data source auto-created for a lakehouse compute profile (queries org Gold tables). */
export function isLakehouseComputeDataSource(
  ds: Pick<DataSource, 'type' | 'format' | 'description' | 'connection_config'> | null | undefined,
): boolean {
  if (!ds || ds.type !== 'warehouse') return false;
  const cfg = (ds.connection_config ?? {}) as Record<string, unknown>;
  if (cfg.source_kind === 'lakehouse_gold') return true;
  return (
    ds.format === 'warehouse'
    && typeof ds.description === 'string'
    && ds.description.toLowerCase().includes('lakehouse')
  );
}

export function lakehouseWarehouseIdFromSource(ds: DataSource | null | undefined): string | null {
  if (!ds) return null;
  const cfg = (ds.connection_config ?? {}) as Record<string, unknown>;
  const id = cfg.warehouse_id;
  return typeof id === 'string' && id ? id : null;
}
