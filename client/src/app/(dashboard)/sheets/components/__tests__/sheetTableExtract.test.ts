import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { writeTable } from '../cellEncoding';
import { expandContiguousTable, extractSheetTableDatasets, selectionFromModel } from '../sheetTableExtract';

describe('extractSheetTableDatasets', () => {
  it('reads header row and numeric cells from the grid', async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('@ironcalc/wasm/wasm_bg.wasm');
    const { initSync, Model } = await import('@ironcalc/wasm');
    initSync({ module: readFileSync(wasmPath) });
    const m = new Model('Book', 'en', 'UTC', 'en');
    writeTable(m, 0, 1, 1, ['store', 'amount'], [['East', 10], ['West', 20]]);
    const sets = extractSheetTableDatasets(m, [], () => 'Sheet1');
    expect(sets).toHaveLength(1);
    expect(sets[0].columns).toEqual(['store', 'amount']);
    expect(sets[0].rows[0][1]).toBe(10);
  });

  it('expands a single selected cell into the contiguous table', async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('@ironcalc/wasm/wasm_bg.wasm');
    const { initSync, Model } = await import('@ironcalc/wasm');
    initSync({ module: readFileSync(wasmPath) });
    const m = new Model('Book', 'en', 'UTC', 'en');
    writeTable(m, 0, 1, 1, ['store', 'amount'], [['East', 10], ['West', 20]]);
    m.setSelectedCell(2, 1);
    const sel = selectionFromModel(m, () => 'Sheet1');
    expect(sel?.endRow).toBeGreaterThan(sel?.row ?? 0);
    const sets = extractSheetTableDatasets(m, [], () => 'Sheet1', sel);
    expect(sets[0]?.id).toBe('selection');
    expect(sets[0]?.rows).toHaveLength(2);
  });
});
