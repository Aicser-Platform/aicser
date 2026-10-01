/**
 * AI suggestions as you type (grey "ghost" text; Tab accepts, Esc dismisses) for SQL and Python
 * cells. A fast model gets the cell around the cursor plus the notebook's DataFrames and the
 * tables at hand. It only asks once typing pauses at the end of a line, never re-asks for the
 * same text, and a newer keystroke cancels the request in flight.
 */
import type * as MonacoApi from 'monaco-editor';
import type { NotebookFrame } from './pythonCompletion';

type Monaco = typeof import('monaco-editor');

export type InlineRequest = {
  language: 'sql' | 'python';
  prefix: string;
  suffix: string;
  frames: NotebookFrame[];
  source?: { name: string; tables: Array<{ name: string; columns: string[] }> };
};
export type InlineFetcher = (body: InlineRequest, signal: AbortSignal) => Promise<string>;

const PAUSE_MS = 650;
const MAX_CACHE = 50;

let fetcher: InlineFetcher | null = null;
let context: Pick<InlineRequest, 'frames' | 'source'> = { frames: [] };
let registered = false;
const cache = new Map<string, string>();

/** The notebook turns suggestions on (with how to fetch them) or off (null). */
export function configureInlineAi(next: InlineFetcher | null, ctx?: Pick<InlineRequest, 'frames' | 'source'>): void {
  fetcher = next;
  if (ctx) context = ctx;
}

const sleep = (ms: number, token: MonacoApi.CancellationToken) =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(!token.isCancellationRequested), ms);
    token.onCancellationRequested(() => {
      clearTimeout(timer);
      resolve(false);
    });
  });

export function registerInlineAi(monaco: Monaco): void {
  if (registered) return;
  registered = true;
  const provider: MonacoApi.languages.InlineCompletionsProvider = {
    async provideInlineCompletions(model, position, _ctx, token) {
      const none = { items: [] };
      if (!fetcher) return none;
      const line = model.getLineContent(position.lineNumber);
      // Only at the end of what's written on the line (auto-closed brackets and quotes after the
      // cursor are fine): mid-line edits are where suggestions get in the way.
      if (/[^\s)\]}'"]/.test(line.slice(position.column - 1))) return none;
      const prefix = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
      if (!prefix.trim() || /^\s*(#|--)/.test(line)) return none;
      const last = model.getLineCount();
      const suffix = model.getValueInRange({
        startLineNumber: position.lineNumber, startColumn: position.column,
        endLineNumber: last, endColumn: model.getLineMaxColumn(last),
      });
      const language = model.getLanguageId() === 'sql' ? 'sql' : 'python';
      const key = `${language}\u0000${prefix}\u0000${suffix}`;
      let text = cache.get(key);
      if (text === undefined) {
        if (!(await sleep(PAUSE_MS, token)) || !fetcher) return none;
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        try {
          text = await fetcher({ language, prefix, suffix, ...context }, controller.signal);
        } catch {
          return none;
        }
        if (token.isCancellationRequested) return none;
        cache.set(key, text);
        if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
      }
      if (!text) return none;
      // Monaco only shows ghost text mid-line when it covers the rest of the line, so the
      // suggestion replaces through the line's end and puts the closing brackets back.
      const rest = line.slice(position.column - 1);
      return {
        items: [{
          insertText: text + rest,
          range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, line.length + 1),
        }],
      };
    },
    disposeInlineCompletions() {
      /* nothing held */
    },
  };
  monaco.languages.registerInlineCompletionsProvider('python', provider);
  monaco.languages.registerInlineCompletionsProvider('sql', provider);
}
