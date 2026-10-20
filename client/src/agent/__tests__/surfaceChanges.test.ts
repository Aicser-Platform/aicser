import { describe, expect, it } from 'vitest';
import { notebookWithChanges } from '../applyNotebookChanges';
import { parseA1 } from '../applySheetChanges';
import { describeSurfaceChanges, parseSurfaceActions } from '../surfaceAgentTypes';
import type { NotebookCell } from '@/services/notebookService';

const cells: NotebookCell[] = [
  { id: 'a', type: 'markdown', source: '# Sales' },
  { id: 'b', type: 'sql', source: 'SELECT 1', name: 'q1', data_source_id: 'ds', output: { columns: [], rows: [] } as never },
  { id: 'c', type: 'python', source: 'df', name: 'df1' },
];

describe('notebook change sets', () => {
  it('edits, deletes and inserts in place, then runs in notebook order', () => {
    let n = 0;
    const { cells: next, run, applied } = notebookWithChanges(
      cells,
      {
        type: 'notebook_changes',
        edit: [{ cell_id: 'b', source: 'SELECT region FROM orders LIMIT 10' }],
        delete: ['c'],
        add: [
          { after_cell_id: 'a', cell_type: 'sql', name: 'by_region', source: 'SELECT 2', data_source_id: 'ds' },
          { after_cell_id: null, cell_type: 'markdown', name: 'note', source: 'Done', data_source_id: null },
        ],
        run: ['b', 'by_region'],
      },
      () => `new${(n += 1)}`,
    );
    expect(next.map((c) => c.id)).toEqual(['a', 'new1', 'b', 'new2']);
    expect(next[2].source).toContain('region');
    expect(next[2].output).toBeNull(); // the old result no longer matches the new SQL
    expect(next[1]).toMatchObject({ type: 'sql', name: 'by_region', data_source_id: 'ds' });
    expect(next[3].name).toBeNull();
    expect(run).toEqual(['new1', 'b']);
    expect(applied).toBe(4);
  });

  it('gives a new result a free name when the proposed one is taken', () => {
    const { cells: next } = notebookWithChanges(
      cells,
      { type: 'notebook_changes', add: [{ after_cell_id: null, cell_type: 'sql', name: 'q1', source: 'SELECT 3', data_source_id: 'ds' }] },
      () => 'x',
    );
    expect(next.at(-1)?.name).toBe('q2');
  });
});

describe('sheet change helpers', () => {
  it('reads A1 references (1-based)', () => {
    expect(parseA1('B12')).toEqual({ row: 12, column: 2 });
    expect(parseA1('$AA$3')).toEqual({ row: 3, column: 27 });
    expect(parseA1('A0')).toBeNull();
    expect(parseA1('nope')).toBeNull();
  });
});

describe('change descriptions', () => {
  const t = (key: string, v?: Record<string, string | number>) => `${key}${v ? ` ${JSON.stringify(v)}` : ''}`;

  it('keeps only change sets it knows', () => {
    expect(parseSurfaceActions([{ type: 'insert_visual_chart' }, { type: 'sheet_changes', writes: [] }, null])).toHaveLength(1);
  });

  it('names each change, with the SQL or formulas one click away', () => {
    const lines = describeSurfaceChanges(
      {
        type: 'sheet_changes',
        sheets: [{ name: 'Summary' }],
        ranges: [{ name: 'orders', sql: 'SELECT 1', data_source_id: 'ds', sheet: 'Summary', anchor: 'A1' }],
        writes: [{ sheet: 'Summary', cell: 'E1', formula: '=SUM(B:B)' }, { sheet: 'Summary', cell: 'D1', value: 'Total' }],
        charts: [{ sheet: 'Summary', range: 'A1:B5', chart_type: 'bar', title: 'By region' }],
      },
      t,
    );
    expect(lines.map((l) => l.key)).toEqual(['sheet-Summary', 'range-orders', 'writes', 'chart-0']);
    expect(lines[1].detail).toBe('SELECT 1');
    expect(lines[2].text).toContain('"formulas":1');
    expect(lines[2].detail).toContain('Summary!E1  =SUM(B:B)');
  });
});
