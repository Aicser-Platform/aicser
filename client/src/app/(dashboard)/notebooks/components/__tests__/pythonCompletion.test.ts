import { describe, expect, it } from 'vitest';
import { registerPythonCompletion, setNotebookFrames, setNotebookSources } from '../pythonCompletion';

type Provider = { provideCompletionItems: (model: unknown, position: unknown) => { suggestions: Array<{ label: string }> } };

let provider: Provider | null = null;
const monaco = {
  languages: {
    CompletionItemKind: { Method: 0, Property: 1, Field: 2, Variable: 3, Module: 4, Function: 5, Value: 6 },
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    registerCompletionItemProvider: (_lang: string, p: Provider) => {
      provider = p;
    },
  },
};
registerPythonCompletion(monaco as never);

function suggest(line: string): string[] {
  const model = {
    getValueInRange: () => line,
    getWordUntilPosition: () => {
      const m = line.match(/[A-Za-z_]\w*$/);
      return { startColumn: line.length + 1 - (m ? m[0].length : 0), endColumn: line.length + 1 };
    },
  };
  return provider!.provideCompletionItems(model, { lineNumber: 1, column: line.length + 1 }).suggestions.map((s) => s.label);
}

setNotebookFrames([{ name: 'q5', columns: ['supplier_name', 'order count', 'total_order_value'], rows: 15 }]);
setNotebookSources(['Retail', 'Finance warehouse']);

describe('notebook Python suggestions', () => {
  it('offers the notebook DataFrames and the libraries for a bare word', () => {
    expect(suggest('q')).toEqual(expect.arrayContaining(['q5', 'pd', 'np']));
  });

  it('offers columns and DataFrame methods after frame.', () => {
    const s = suggest('q5.');
    expect(s).toEqual(expect.arrayContaining(['supplier_name', 'total_order_value', 'groupby', 'head']));
    expect(s).not.toContain('order count'); // not a valid attribute name
  });

  it('offers every column inside frame["', () => {
    expect(suggest('q5["')).toEqual(['supplier_name', 'order count', 'total_order_value']);
  });

  it('offers Series methods after a column', () => {
    expect(suggest("q5['supplier_name'].")).toEqual(expect.arrayContaining(['value_counts', 'nunique', 'str']));
  });

  it('offers pandas and numpy functions', () => {
    expect(suggest('pd.')).toEqual(expect.arrayContaining(['to_datetime', 'concat']));
    expect(suggest('np.')).toEqual(expect.arrayContaining(['where', 'percentile']));
  });

  it('offers the governed loader and source names', () => {
    expect(suggest('a')).toContain('aicser');
    expect(suggest('df = aicser.')).toEqual(['table', 'sql', 'sources', 'models', 'predict', 'forecast', 'save_forecast', 'decisions', 'decide']);
    expect(suggest('df = aicser.table("s.t", source="')).toEqual(['Retail', 'Finance warehouse']);
  });
});
