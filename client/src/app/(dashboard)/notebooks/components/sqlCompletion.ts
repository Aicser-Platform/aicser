/**
 * Table and column autocomplete for notebook SQL cells. One provider is registered per Monaco
 * instance; each editor model is tied to the schema of the data source its cell reads.
 */
import type { SchemaInfo } from '@/stores/useDataSourceStore';

type Monaco = typeof import('monaco-editor');

const schemaByModel = new Map<string, SchemaInfo>();
const schemaCache = new Map<string, Promise<SchemaInfo | null>>();
let registered = false;

export function schemaFor(dataSourceId: string): Promise<SchemaInfo | null> {
  if (!schemaCache.has(dataSourceId)) {
    schemaCache.set(
      dataSourceId,
      import('@/api/dataSources')
        .then((api) => api.getDataSourceSchema(dataSourceId))
        .then((res) => res.schema)
        .catch(() => {
          schemaCache.delete(dataSourceId);
          return null;
        }),
    );
  }
  return schemaCache.get(dataSourceId)!;
}

export function tableName(t: { name: string; schema?: string }): string {
  return t.schema ? `${t.schema}.${t.name}` : t.name;
}

export function bindModelSchema(uri: string, schema: SchemaInfo | null): void {
  if (schema) schemaByModel.set(uri, schema);
  else schemaByModel.delete(uri);
}

export function registerSqlCompletion(monaco: Monaco): void {
  if (registered) return;
  registered = true;
  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' '],
    provideCompletionItems(model, position) {
      const schema = schemaByModel.get(model.uri.toString());
      if (!schema?.tables?.length) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions: import('monaco-editor').languages.CompletionItem[] = [];
      for (const t of schema.tables) {
        suggestions.push({
          label: tableName(t),
          kind: monaco.languages.CompletionItemKind.Class,
          detail: t.rowCount != null ? `table · ${t.rowCount.toLocaleString()} rows` : 'table',
          insertText: tableName(t),
          range,
        });
        for (const c of t.columns ?? []) {
          suggestions.push({
            label: c.name,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: `${t.name} · ${c.type}`,
            insertText: /^[a-z_][a-z0-9_]*$/.test(c.name) ? c.name : `"${c.name.replace(/"/g, '""')}"`,
            range,
          });
        }
      }
      return { suggestions };
    },
  });
}

/** Editor colours that sit on the cell's own background in both themes. */
export function defineNotebookThemes(monaco: Monaco): void {
  const css = getComputedStyle(document.documentElement);
  const bg = (css.getPropertyValue('--ant-color-bg-container') || '').trim();
  const hex = /^#[0-9a-f]{6}$/i.test(bg) ? bg : null;
  monaco.editor.defineTheme('aicser-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: { 'editor.background': hex && !isDark(hex) ? hex : '#ffffff', 'editorLineNumber.foreground': '#9aa5ab' },
  });
  monaco.editor.defineTheme('aicser-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: { 'editor.background': hex && isDark(hex) ? hex : '#161b22', 'editorLineNumber.foreground': '#5b6770' },
  });
}

function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 128;
}
