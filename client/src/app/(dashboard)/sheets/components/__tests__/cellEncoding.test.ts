import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { cellInput, columnKinds, serialOf, writeTable } from '../cellEncoding';

describe('typing query results for a sheet', () => {
  it('types each column from its values', () => {
    const rows = [
      [1, '12.5', '2024-01-05', '2024-01-05T10:30:00Z', true, '00123', '2024-02-01T00:00:00', null],
      [2, '-3', '2024-01-06', '2024-01-06 11:00:00', false, 'A12', '2024-02-02 00:00:00', 'x'],
    ];
    expect(columnKinds(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], rows))
      .toEqual(['number', 'number', 'date', 'datetime', 'bool', 'text', 'date', 'text']);
  });

  it('never lets data become a formula', () => {
    for (const v of ['=HYPERLINK("http://x")', '+1', '-2+3', '@SUM(A1)', 'plain']) {
      expect(cellInput(v, 'text')).toBe(`'${v}`);
    }
    expect(cellInput(null, 'text')).toBeNull();
    expect(cellInput('', 'number')).toBeNull();
  });

  it('writes numbers, booleans, dates and date-time serials', () => {
    expect(cellInput('12.50', 'number')).toBe('12.5');
    expect(cellInput(true, 'bool')).toBe('TRUE');
    expect(cellInput('2024-01-05T00:00:00', 'date')).toBe('2024-01-05');
    expect(serialOf('1900-01-01')).toBe(2);
    expect(serialOf('2024-01-05T12:00:00Z')).toBe(45296.5);
  });
});

describe('writing into the IronCalc engine', () => {
  it('writes a table whose formulas and text behave', async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('@ironcalc/wasm/wasm_bg.wasm');
    const { initSync, Model } = await import('@ironcalc/wasm');
    initSync({ module: readFileSync(wasmPath) });
    const m = new Model('Book', 'en', 'UTC', 'en');
    const out = writeTable(m, 0, 2, 2, ['store', 'amount', 'note'], [['S1', 120, '=1+1'], ['S2', '80', '+5']]);
    expect(out).toEqual({ width: 3, height: 3 });
    m.setUserInput(0, 5, 3, '=SUM(C3:C4)');
    m.evaluate();
    expect(m.getFormattedCellValue(0, 5, 3)).toBe('200');
    expect(m.getFormattedCellValue(0, 3, 4)).toBe('=1+1');
    expect(m.getFormattedCellValue(0, 2, 2)).toBe('store');
  });
});
