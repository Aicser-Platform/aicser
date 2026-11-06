import type { PipelineExportDbType } from './pipelineWizardReturn';

export type PipelineFileExportType = 'csv' | 'parquet' | 'excel';

export type PipelineExportDestType = PipelineExportDbType | 'google_sheets' | PipelineFileExportType;

export type PipelineExportGroup = 'warehouse_export' | 'spreadsheet_export' | 'file_export';

export type PipelineExportCatalogEntry = {
  type: PipelineExportDestType;
  group: PipelineExportGroup;
  icon: string;
  /** UniversalDataSourceModal preset for file exports (upload target). */
  fileModalType?: 'file';
};

export const PIPELINE_EXPORT_CATALOG: PipelineExportCatalogEntry[] = [
  { type: 'postgresql', group: 'warehouse_export', icon: 'postgresql' },
  { type: 'mysql', group: 'warehouse_export', icon: 'mysql' },
  { type: 'clickhouse', group: 'warehouse_export', icon: 'clickhouse' },
  { type: 'sqlserver', group: 'warehouse_export', icon: 'sqlserver' },
  { type: 'google_sheets', group: 'spreadsheet_export', icon: 'google_sheets' },
  { type: 'csv', group: 'file_export', icon: 'csv', fileModalType: 'file' },
  { type: 'parquet', group: 'file_export', icon: 'parquet', fileModalType: 'file' },
  { type: 'excel', group: 'file_export', icon: 'excel', fileModalType: 'file' },
];

export function isPipelineFileExportType(t: string): t is PipelineFileExportType {
  return t === 'csv' || t === 'parquet' || t === 'excel';
}

export function isPipelineExportDestType(t: string): t is PipelineExportDestType {
  return PIPELINE_EXPORT_CATALOG.some((e) => e.type === t);
}

export function catalogEntryFor(destType: string): PipelineExportCatalogEntry | undefined {
  return PIPELINE_EXPORT_CATALOG.find((e) => e.type === destType);
}
