import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('src/styles/aicser-ui.css', () => {
  it('is up to date with Aicser UI classes and tokens (run `npm run ui:css`)', async () => {
    // @ts-expect-error -- plain ESM build script, no type declarations
    const { buildUiCss } = await import('../../scripts/build-ui-css.mjs');
    const current = readFileSync(path.resolve(__dirname, 'aicser-ui.css'), 'utf8');
    expect(current === (await buildUiCss())).toBe(true);
  }, 30_000);

  it('only styles inside the scope', () => {
    const css = readFileSync(path.resolve(__dirname, 'aicser-ui.css'), 'utf8');
    expect(css).toContain('.aicser-ui .bg-primary');
    // Colour names AntD pages already use as their own classes stay scoped.
    expect(css).not.toMatch(/^\.text-secondary\b/m);
    expect(css).not.toMatch(/^\.bg-primary\b/m);
  });
});
