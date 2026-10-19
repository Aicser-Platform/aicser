/**
 * Live workbook (all tabs) → ACC artifacts for sheet copilot.
 */

import type { Model } from '@ironcalc/workbook';
import type { SurfaceContext } from '@/agent/surfaceContext';
import { buildSheetSurfaceContext } from '@/agent/surfaceContext';
import type { DataRange } from '@/services/workbookService';
import {
  extractSheetTableDatasets,
  type SheetGridSelection,
} from '@/app/(dashboard)/sheets/components/sheetTableExtract';
import { areaRef } from '@/app/(dashboard)/sheets/components/sheetData';
import { scanWorkbookDataQuality } from '@/app/(dashboard)/sheets/components/sheetDataQualityScan';
import { withSurfaceDataConnectivity } from '@/agent/surfaceDataConnectivity';

const MAX_TABLE_ROWS_IN_ACC = 24;

export function summarizeWorkbookSheets(
  model: Model | null,
  sheetName: (sheet: number) => string,
): Array<Record<string, unknown>> {
  if (!model) return [];
  const props = model.getWorksheetsProperties();
  return props.map((p, index) => {
    let dataRowCount: number | undefined;
    try {
      const rows = Array.from(model.getRowsWithData(index, 1));
      dataRowCount = rows.length;
    } catch {
      dataRowCount = undefined;
    }
    return {
      index,
      name: p.name,
      state: p.state,
      data_row_count: dataRowCount,
      is_active: model.getSelectedSheet?.() === index,
    };
  });
}

export function summarizeWorkbookRanges(
  ranges: DataRange[],
  sheetName: (sheet: number) => string,
): Array<Record<string, unknown>> {
  return ranges.map((r) => ({
    id: r.id,
    name: r.name ?? undefined,
    sheet_index: r.sheet,
    sheet_name: sheetName(r.sheet),
    anchor: areaRef(sheetName(r.sheet), {
      row: r.row,
      column: r.column,
      width: r.width,
      height: r.height,
    }),
    mode: r.mode,
    data_source_id: r.data_source_id ?? undefined,
    sql:
      r.sql && r.sql.length > 6000 ? `${r.sql.slice(0, 6000)}…` : r.sql ?? undefined,
    sql_preview: r.sql ? (r.sql.length > 400 ? `${r.sql.slice(0, 400)}…` : r.sql) : undefined,
    row_count: r.row_count ?? undefined,
    refreshed_at: r.refreshed_at ?? undefined,
    pending: r.pending ?? false,
  }));
}

export function summarizeWorkbookTables(
  model: Model | null,
  ranges: DataRange[],
  sheetName: (sheet: number) => string,
  gridSelection?: SheetGridSelection | null,
): Array<Record<string, unknown>> {
  const datasets = extractSheetTableDatasets(model, ranges, sheetName, gridSelection);
  return datasets.map((d) => ({
    id: d.id,
    name: d.name,
    source_kind: d.sourceKind,
    range_id: d.rangeId,
    live: d.live ?? false,
    columns: d.columns.slice(0, 20),
    row_count: d.rows.length,
    sample_rows: d.rows.slice(0, MAX_TABLE_ROWS_IN_ACC),
  }));
}

export function buildSheetStudioSurfaceContext(opts: {
  workbookId: string;
  title?: string;
  intent?: SurfaceContext['intent'];
  model: Model | null;
  ranges: DataRange[];
  sheetName: (sheet: number) => string;
  gridSelection?: SheetGridSelection | null;
  selectionA1?: string;
  sheetNameActive?: string;
  parameters?: Record<string, unknown>;
  askSnapshotStale?: boolean;
  linkedAskDataSourceId?: string;
  dataSourceId?: string;
}): SurfaceContext {
  const base = buildSheetSurfaceContext({
    workbookId: opts.workbookId,
    title: opts.title,
    intent: opts.intent,
    ranges: summarizeWorkbookRanges(opts.ranges, opts.sheetName),
    selectionA1: opts.selectionA1 ?? opts.gridSelection?.label,
    sheetName: opts.sheetNameActive,
    parameters: opts.parameters,
    askSnapshotStale: opts.askSnapshotStale,
    linkedAskDataSourceId: opts.linkedAskDataSourceId,
    dataSourceId: opts.dataSourceId,
  });
  const dataQuality = scanWorkbookDataQuality(opts.model, opts.sheetName);
  const ctx: SurfaceContext = {
    ...base,
    artifacts: {
      ...base.artifacts,
      sheets: summarizeWorkbookSheets(opts.model, opts.sheetName),
      ranges: summarizeWorkbookRanges(opts.ranges, opts.sheetName),
      tables: summarizeWorkbookTables(opts.model, opts.ranges, opts.sheetName, opts.gridSelection),
      data_quality: dataQuality ?? undefined,
    },
  };
  return withSurfaceDataConnectivity(ctx);
}
