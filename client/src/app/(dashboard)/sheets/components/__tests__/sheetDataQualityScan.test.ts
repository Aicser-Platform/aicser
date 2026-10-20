import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { scanWorkbookDataQuality } from '../sheetDataQualityScan';

describe('scanWorkbookDataQuality', () => {
  it('detects mixed-type columns in a sampled table', async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('@ironcalc/wasm/wasm_bg.wasm');
    const { initSync, Model } = await import('@ironcalc/wasm');
    initSync({ module: readFileSync(wasmPath) });
    const model = new Model('Book', 'en', 'UTC', 'en');
    const sheet = 0;
    model.setUserInput(sheet, 1, 1, "'id");
    model.setUserInput(sheet, 1, 2, "'amount");
    model.setUserInput(sheet, 2, 1, "'a");
    model.setUserInput(sheet, 2, 2, '10');
    model.setUserInput(sheet, 3, 1, "'b");
    model.setUserInput(sheet, 3, 2, "'oops");
    const snap = scanWorkbookDataQuality(model, () => 'Sheet1');
    expect(snap).not.toBeNull();
    expect(snap!.sheets[0].columns.length).toBe(2);
    expect(snap!.sheets[0].issues.some((i) => i.includes('mixed'))).toBe(true);
  });
});
