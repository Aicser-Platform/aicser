import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { writeTable } from '../cellEncoding';

describe('IronCalc lookup formulas', () => {
  it('evaluates VLOOKUP against an in-sheet table', async () => {
    const require = createRequire(import.meta.url);
    const { initSync, Model } = await import('@ironcalc/wasm');
    initSync({ module: readFileSync(require.resolve('@ironcalc/wasm/wasm_bg.wasm')) });
    const m = new Model('Book', 'en', 'UTC', 'en');
    writeTable(m, 0, 1, 1, ['code', 'label'], [['A', 'Alpha'], ['B', 'Beta']]);
    m.setUserInput(0, 4, 1, 'A');
    m.setUserInput(0, 4, 2, '=VLOOKUP(A4,A1:B2,2,FALSE)');
    m.evaluate();
    const out = m.getFormattedCellValue(0, 4, 2);
    expect(out).toBe('Alpha');
  });
});
