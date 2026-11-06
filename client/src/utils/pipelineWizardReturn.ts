const RETURN_KEY = 'aicser.pipelineWizard.returnTo';

export function rememberPipelineWizardReturn(path?: string) {
  if (typeof window === 'undefined') return;
  const target = path || `${window.location.pathname}${window.location.search}`;
  try {
    window.sessionStorage.setItem(RETURN_KEY, target);
  } catch {
    /* private mode */
  }
}

export function consumePipelineWizardReturn(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.sessionStorage.getItem(RETURN_KEY);
    if (v) window.sessionStorage.removeItem(RETURN_KEY);
    return v;
  } catch {
    return null;
  }
}

/** Opens Data connect flow pre-filled for pipeline lake bucket (not SQL warehouse). */
export const PIPELINE_LAKE_CONNECT_QUERY = '/data?openDataSource=1&preset=pipeline_lake_s3';

/** @deprecated use PIPELINE_LAKE_CONNECT_QUERY */
export const LAKE_S3_CONNECT_QUERY = PIPELINE_LAKE_CONNECT_QUERY;

import {
  isPipelineExportDestType,
  type PipelineExportDestType,
  type PipelineFileExportType,
} from './pipelineExportCatalog';

export type PipelineExportDbType = 'postgresql' | 'mysql' | 'clickhouse' | 'sqlserver';

export type { PipelineExportDestType, PipelineFileExportType };

const PIPELINE_EXPORT_PRESET_PREFIX = 'pipeline_export_';

/** Deep link to register a warehouse DB for pipeline Gold export (returns via sessionStorage). */
export function pipelineExportConnectQuery(destType: PipelineExportDestType): string {
  return `/data?openDataSource=1&preset=${PIPELINE_EXPORT_PRESET_PREFIX}${destType}`;
}

export function parsePipelineExportPreset(preset: string | null | undefined): PipelineExportDestType | null {
  if (!preset?.startsWith(PIPELINE_EXPORT_PRESET_PREFIX)) return null;
  const db = preset.slice(PIPELINE_EXPORT_PRESET_PREFIX.length) as PipelineExportDestType;
  if (isPipelineExportDestType(db)) {
    return db;
  }
  return null;
}
