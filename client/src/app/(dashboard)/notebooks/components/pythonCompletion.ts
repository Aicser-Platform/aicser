/**
 * Python suggestions for notebook cells: the notebook's own DataFrames (SQL results and frames
 * made in Python) with their columns, plus the pandas / numpy calls people reach for. The
 * browser runtime has no Python language server, so without this Monaco only offered words it
 * had seen in the cell.
 */
import type * as MonacoApi from 'monaco-editor';

type Monaco = typeof import('monaco-editor');

export type NotebookFrame = { name: string; columns: string[]; rows?: number };

let frames: NotebookFrame[] = [];
let sources: string[] = [];
let registered = false;

/** The notebook editor keeps this current as cells run. */
export function setNotebookFrames(next: NotebookFrame[]): void {
  frames = next.filter((f) => f && f.name);
}

/** Data source names, offered inside aicser.table(..., source="…"). */
export function setNotebookSources(next: string[]): void {
  sources = next.filter(Boolean);
}

const DATAFRAME: Array<[string, string]> = [
  ['head', 'first rows (n=5)'], ['tail', 'last rows (n=5)'], ['describe', 'summary statistics'],
  ['info', 'columns, types, missing values'], ['groupby', 'group rows by columns'], ['agg', 'aggregate columns'],
  ['sort_values', 'sort by columns'], ['merge', 'join another DataFrame'], ['pivot_table', 'spreadsheet-style pivot'],
  ['drop_duplicates', 'remove duplicate rows'], ['dropna', 'drop missing values'], ['fillna', 'fill missing values'],
  ['rename', 'rename columns'], ['assign', 'add computed columns'], ['query', 'filter with an expression'],
  ['loc', 'select by label'], ['iloc', 'select by position'], ['reset_index', 'index back to a column'],
  ['set_index', 'use a column as the index'], ['astype', 'change column types'], ['apply', 'apply a function'],
  ['resample', 'regroup a time series'], ['melt', 'wide to long'], ['nlargest', 'top rows by a column'],
  ['nsmallest', 'bottom rows by a column'], ['sample', 'random rows'], ['corr', 'correlation matrix'],
  ['isna', 'missing-value mask'], ['plot', 'chart (matplotlib)'], ['copy', 'independent copy'],
  ['sum', 'column totals'], ['mean', 'column means'], ['median', 'column medians'], ['count', 'non-missing counts'],
  ['shape', 'rows, columns'], ['columns', 'column names'], ['dtypes', 'column types'],
];
const SERIES: Array<[string, string]> = [
  ['value_counts', 'frequency of each value'], ['unique', 'distinct values'], ['nunique', 'number of distinct values'],
  ['sum', 'total'], ['mean', 'average'], ['median', 'median'], ['std', 'standard deviation'], ['min', 'smallest'],
  ['max', 'largest'], ['round', 'round values'], ['astype', 'change type'], ['str', 'string methods'],
  ['dt', 'date/time parts'], ['map', 'map values'], ['apply', 'apply a function'], ['fillna', 'fill missing'],
  ['isna', 'missing-value mask'], ['isin', 'membership test'], ['between', 'range test'], ['cumsum', 'running total'],
  ['pct_change', 'percent change'], ['rolling', 'moving window'], ['shift', 'lag / lead'], ['clip', 'bound values'],
  ['sort_values', 'sort'], ['idxmax', 'label of the largest'], ['plot', 'chart (matplotlib)'],
];
const PANDAS: Array<[string, string]> = [
  ['DataFrame', 'build a DataFrame'], ['Series', 'build a Series'], ['concat', 'stack DataFrames'],
  ['merge', 'join DataFrames'], ['to_datetime', 'parse dates'], ['to_numeric', 'parse numbers'],
  ['pivot_table', 'spreadsheet-style pivot'], ['crosstab', 'frequency table'], ['cut', 'bin values'],
  ['qcut', 'quantile bins'], ['get_dummies', 'one-hot encode'], ['date_range', 'sequence of dates'],
  ['isna', 'missing-value mask'], ['notna', 'present-value mask'],
];
const NUMPY: Array<[string, string]> = [
  ['array', 'build an array'], ['arange', 'evenly spaced values'], ['linspace', 'n values in a range'],
  ['where', 'choose by condition'], ['mean', 'average'], ['median', 'median'], ['std', 'standard deviation'],
  ['percentile', 'percentile'], ['log', 'natural log'], ['exp', 'exponential'], ['sqrt', 'square root'],
  ['round', 'round'], ['abs', 'absolute value'], ['clip', 'bound values'], ['cumsum', 'running total'], ['nan', 'missing value'],
];
const AICSER: Array<[string, string, string]> = [
  ['table', 'aicser.table("schema.table", source="…")', 'table(${1:"schema.table"}, source=${2:"source"})'],
  ['sql', 'aicser.sql("SELECT …", source="…")', 'sql(${1:"SELECT "}, source=${2:"source"})'],
  ['sources', 'the data sources you can load from', 'sources()'],
  ['models', 'prediction and forecast models you can use', 'models()'],
  ['predict', 'aicser.predict("model", df) · adds its prediction', 'predict(${1:"model"}, ${2:df})'],
  ['forecast', 'aicser.forecast(df, time=…, value=…) or a forecast model', 'forecast(${1:df}, time=${2:"date"}, value=${3:"value"}, periods=${4:12})'],
  ['save_forecast', 'keep a forecast as a versioned model', 'save_forecast(${1:"name"}, sql=${2:"SELECT …"}, time=${3:"date"}, value=${4:"value"})'],
  ['decisions', 'your saved AI decisions', 'decisions()'],
  ['decide', 'aicser.decide("decision", df, text="column")', 'decide(${1:"decision"}, ${2:df}, text=${3:"column"})'],
];
const PROPERTIES = new Set(['shape', 'columns', 'dtypes', 'loc', 'iloc', 'str', 'dt', 'nan']);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function registerPythonCompletion(monaco: Monaco): void {
  if (registered) return;
  registered = true;
  const Kind = monaco.languages.CompletionItemKind;
  monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.', '[', '"', "'"],
    provideCompletionItems(model, position) {
      const before = model.getValueInRange({
        startLineNumber: position.lineNumber, startColumn: 1,
        endLineNumber: position.lineNumber, endColumn: position.column,
      });
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      };
      const byName = new Map(frames.map((f) => [f.name, f]));
      const out: MonacoApi.languages.CompletionItem[] = [];
      const methods = (list: Array<[string, string]>, detail: string) => {
        for (const [name, doc] of list) {
          const prop = PROPERTIES.has(name);
          out.push({
            label: name, kind: prop ? Kind.Property : Kind.Method, detail: `${detail} · ${doc}`,
            insertText: prop ? name : `${name}($0)`,
            insertTextRules: prop ? undefined : monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText: `1${name}`, range,
          });
        }
      };
      const columns = (f: NotebookFrame, asAttribute: boolean) => {
        for (const c of f.columns) {
          if (asAttribute && !IDENT.test(c)) continue;
          out.push({
            label: c, kind: Kind.Field, detail: `column of ${f.name}`, insertText: c, sortText: `0${c}`, range,
          });
        }
      };

      // aicser.table(..., source="…
      if (/\baicser\.(?:table|sql)\(.*\bsource\s*=\s*['"][^'"]*$/.test(before)) {
        for (const name of sources) {
          out.push({ label: name, kind: Kind.Value, detail: 'data source', insertText: name, sortText: `0${name}`, range });
        }
        return { suggestions: out };
      }
      // frame['col  /  frame["col
      const bracket = before.match(/([A-Za-z_][A-Za-z0-9_]*)\[\s*['"][^'"]*$/);
      if (bracket && byName.has(bracket[1])) {
        columns(byName.get(bracket[1])!, false);
        return { suggestions: out };
      }
      // frame['col'].  /  frame.col.  → Series
      if (/\]\s*\.\s*[A-Za-z_]*$/.test(before) || /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\.\s*[A-Za-z_]*$/.test(before)) {
        const m = before.match(/\b([A-Za-z_]\w*)[.[]/);
        if (m && byName.has(m[1])) {
          methods(SERIES, 'Series');
          return { suggestions: out };
        }
      }
      // name.  → DataFrame / pandas / numpy
      const dot = before.match(/\b([A-Za-z_][A-Za-z0-9_]*)\.\s*[A-Za-z_]*$/);
      if (dot) {
        const base = dot[1];
        if (byName.has(base)) {
          columns(byName.get(base)!, true);
          methods(DATAFRAME, 'DataFrame');
        } else if (base === 'pd' || base === 'pandas') {
          methods(PANDAS, 'pandas');
        } else if (base === 'np' || base === 'numpy') {
          methods(NUMPY, 'numpy');
        } else if (base === 'aicser') {
          for (const [name, detail, snippet] of AICSER) {
            out.push({
              label: name, kind: Kind.Function, detail: `load data · ${detail}`, insertText: snippet,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, sortText: `0${name}`, range,
            });
          }
        }
        return { suggestions: out };
      }
      // Bare word: the DataFrames this notebook has, then the libraries.
      for (const f of frames) {
        out.push({
          label: f.name, kind: Kind.Variable,
          detail: `DataFrame${typeof f.rows === 'number' ? ` · ${f.rows.toLocaleString()} rows` : ''} · ${f.columns.length} columns`,
          documentation: f.columns.slice(0, 40).join(', '), insertText: f.name, sortText: `0${f.name}`, range,
        });
      }
      for (const [lib, detail] of [['pd', 'pandas'], ['np', 'numpy'], ['aicser', 'load tables from your data sources']]) {
        out.push({ label: lib, kind: Kind.Module, detail, insertText: lib, sortText: `1${lib}`, range });
      }
      return { suggestions: out };
    },
  });
}
