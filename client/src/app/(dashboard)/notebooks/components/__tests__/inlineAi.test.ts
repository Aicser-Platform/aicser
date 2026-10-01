import { describe, expect, it, vi } from 'vitest';
import { configureInlineAi, registerInlineAi } from '../inlineAi';

type Item = { insertText: string; range: { startColumn: number; endColumn: number } };
type Provider = { provideInlineCompletions: (m: unknown, p: unknown, c: unknown, t: unknown) => Promise<{ items: Item[] }> };

let provider: Provider | null = null;
class Range {
  constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {}
}
registerInlineAi({
  Range,
  languages: { registerInlineCompletionsProvider: (_l: string, p: Provider) => { provider = p; } },
} as never);

function model(lines: string[]) {
  return {
    getLineContent: (n: number) => lines[n - 1],
    getLineCount: () => lines.length,
    getLineMaxColumn: (n: number) => lines[n - 1].length + 1,
    getLanguageId: () => 'python',
    getValueInRange: (r: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) => {
      const text = lines.join('\n');
      const offset = (ln: number, col: number) => lines.slice(0, ln - 1).reduce((a, l) => a + l.length + 1, 0) + col - 1;
      return text.slice(offset(r.startLineNumber, r.startColumn), offset(r.endLineNumber, r.endColumn));
    },
  };
}
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

describe('inline AI suggestions', () => {
  it('suggests before auto-closed brackets, covering the rest of the line', async () => {
    const fetcher = vi.fn(async () => "'total', ascending=False");
    configureInlineAi(fetcher, { frames: [{ name: 'daily', columns: ['total'] }] });
    const line = 'top = daily.sort_values()';
    const out = await provider!.provideInlineCompletions(model([line]), { lineNumber: 1, column: line.length }, {}, token);
    expect(out.items[0].insertText).toBe("'total', ascending=False)");
    expect(out.items[0].range.endColumn).toBe(line.length + 1);
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'top = daily.sort_values(', suffix: ')', language: 'python' }), expect.anything());
  });

  it('stays quiet mid-line, on comments, when off, and asks once for the same text', async () => {
    const fetcher = vi.fn(async () => 'x');
    configureInlineAi(fetcher, { frames: [] });
    const mid = 'a = foo(bar)';
    expect((await provider!.provideInlineCompletions(model([mid]), { lineNumber: 1, column: 5 }, {}, token)).items).toEqual([]);
    expect((await provider!.provideInlineCompletions(model(['# note']), { lineNumber: 1, column: 7 }, {}, token)).items).toEqual([]);
    const l = 'b = 1 +';
    await provider!.provideInlineCompletions(model([l]), { lineNumber: 1, column: l.length + 1 }, {}, token);
    await provider!.provideInlineCompletions(model([l]), { lineNumber: 1, column: l.length + 1 }, {}, token);
    expect(fetcher).toHaveBeenCalledTimes(1);
    configureInlineAi(null);
    expect((await provider!.provideInlineCompletions(model(['c = 2 *']), { lineNumber: 1, column: 8 }, {}, token)).items).toEqual([]);
  });
});
