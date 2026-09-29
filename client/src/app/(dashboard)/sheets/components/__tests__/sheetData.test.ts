import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/enhancedDataService', () => ({ enhancedDataService: {} }));
vi.mock('@/utils/api', () => ({ fetchApi: vi.fn() }));

import { areaRef, cellRef, columnLetters, overlaps, tableQuery } from '../sheetData';
import { writeTable } from '../cellEncoding';
import { sheetContext } from '../FormulaAssistant';

describe('addresses and ranges', () => {
  it('names columns and cells like a spreadsheet', () => {
    expect([1, 26, 27, 52, 703].map(columnLetters)).toEqual(['A', 'Z', 'AA', 'AZ', 'AAA']);
    expect(cellRef('Sheet1', 4, 2)).toBe('Sheet1!B4');
    expect(cellRef("Q1 plan", 1, 1)).toBe("'Q1 plan'!A1");
    expect(areaRef('Sheet1', { row: 2, column: 2, width: 3, height: 10 })).toBe('Sheet1!B2:D11');
  });

  it('finds overlapping ranges on the same sheet only', () => {
    const a = { sheet: 0, row: 1, column: 1, width: 3, height: 5 };
    expect(overlaps(a, { sheet: 0, row: 5, column: 3, width: 2, height: 2 })).toBe(true);
    expect(overlaps(a, { sheet: 0, row: 6, column: 1, width: 2, height: 2 })).toBe(false);
    expect(overlaps(a, { sheet: 1, row: 1, column: 1, width: 3, height: 5 })).toBe(false);
  });

  it('quotes table names that need it', () => {
    expect(tableQuery('retail.Order Items')).toContain('FROM retail."Order Items"');
  });
});

describe('what the AI sees of a sheet', () => {
  it('lists cells by address and each range with its headers', async () => {
    const require = createRequire(import.meta.url);
    const { initSync, Model } = await import('@ironcalc/wasm');
    initSync({ module: readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) });
    const m = new Model('Book', 'en', 'UTC', 'en');
    writeTable(m, 0, 1, 1, ['store', 'amount'], [['S1', 120], ['S2', 80]]);
    m.setUserInput(0, 5, 4, '=SUM(B2:B3)');
    const ctx = sheetContext(m, 0, [{ id: 'r', name: 'Orders', sheet: 0, row: 1, column: 1, width: 2, height: 3, mode: 'live' }], () => 'Sheet1');
    expect(ctx.grid).toContain('A1: store');
    expect(ctx.grid).toContain('B2: 120');
    expect(ctx.grid).toContain('D5: =SUM(B2:B3)');
    expect(ctx.ranges).toEqual([{ name: 'Orders', area: 'Sheet1!A1:B3', header_row: 1, columns: ['store', 'amount'] }]);
  });
});
