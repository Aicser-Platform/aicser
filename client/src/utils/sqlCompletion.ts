/**
 * SQL completion and Jinja template support for Monaco editor.
 * Used by MonacoSQLEditor to provide schema-tailored autocomplete and Jinja placeholders.
 */

/** Common SQL keywords for completion (dialect-agnostic) */
export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET',
  'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN', 'ON',
  'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS NULL', 'AS',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'HAVING',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'UNION', 'UNION ALL', 'WITH', 'INSERT INTO', 'UPDATE', 'DELETE FROM',
  'CREATE', 'ALTER', 'DROP', 'CAST', 'COALESCE', 'NULLIF',
];

/** Jinja-style placeholder labels and insert text for template completion */
export const JINJA_PLACEHOLDERS = [
  { label: '{{ table }}', insertText: '{{ table }}', detail: 'Jinja: table name' },
  { label: '{{ schema.table }}', insertText: '{{ schema.table }}', detail: 'Jinja: schema.table' },
  { label: '{{ columns }}', insertText: '{{ columns }}', detail: 'Jinja: column list' },
  { label: '{{ table_name }}', insertText: '{{ table_name }}', detail: 'Jinja: table name (snake_case)' },
];

/** Monaco CompletionItemKind enum values (stable) */
export const CompletionKind = {
  Keyword: 14,
  Class: 7,   // table
  Field: 9,   // column
  Snippet: 27,
} as const;

export interface SchemaTable {
  name?: string;
  table_name?: string;
  schema?: string;
  columns?: Array<{ name?: string; column_name?: string } | string>;
}

/**
 * Build schema-tailored and Jinja completion items for the current cursor context.
 */
export function buildSQLCompletionItems(
  params: {
    textUntil: string;
    word: string;
    range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number };
    tables: SchemaTable[];
  }
): Array<{ label: string; kind: number; insertText: string; range: typeof params.range; detail?: string }> {
  const { textUntil, word, range, tables } = params;
  const suggestions: Array<{ label: string; kind: number; insertText: string; range: typeof range; detail?: string }> = [];
  const lower = (word || '').toLowerCase();

  const afterFromOrJoin = /\b(?:FROM|JOIN)\s+$/i.test(textUntil.trimEnd());
  const afterDot = textUntil.match(/(\S+)\.\s*$/);
  const tableBeforeDot = afterDot ? afterDot[1].trim().replace(/^["']|["']$/g, '') : null;
  const wantsJinja = lower.startsWith('{{') || textUntil.endsWith('{{');

  // 1) After "table." → only that table's columns
  if (tableBeforeDot && tables.length) {
    const targetTable = tables.find((t) => {
      const n = t.name || t.table_name;
      const qual = t.schema && t.schema !== 'public' ? `${t.schema}.${n}` : n;
      return n?.toLowerCase() === tableBeforeDot.toLowerCase() || qual?.toLowerCase() === tableBeforeDot.toLowerCase();
    });
    const cols = targetTable?.columns || [];
    for (const c of cols) {
      const colName = typeof c === 'object' ? (c.name || c.column_name) : c;
      if (colName && (!lower || String(colName).toLowerCase().includes(lower))) {
        const insert = String(colName).includes(' ') ? `"${colName}"` : colName;
        suggestions.push({ label: colName, kind: CompletionKind.Field, insertText: insert, range, detail: 'Column' });
      }
    }
    if (suggestions.length) return suggestions;
  }

  // 2) SQL keywords (when user typed something, suggest matching keywords)
  if (lower && !lower.startsWith('{{')) {
    for (const kw of SQL_KEYWORDS) {
      const kwLower = kw.toLowerCase();
      if (!kwLower.includes(lower)) continue;
      suggestions.push({
        label: kw,
        kind: CompletionKind.Keyword,
        insertText: kw,
        range,
        detail: 'SQL keyword',
      });
    }
  }

  // 3) Schema: tables and columns (tailored to selected data source)
  // For file sources backend uses unqualified "data"; don't qualify for 'public' or 'file'
  for (const t of tables) {
    const tableName = t.name || t.table_name || '';
    if (!tableName) continue;
    const schemaName = t.schema || 'public';
    const noQualify = !schemaName || schemaName === 'public' || schemaName === 'file';
    const qualified = noQualify ? tableName : `${schemaName}.${tableName}`;
    if (tableName && (!lower || String(tableName).toLowerCase().includes(lower))) {
      suggestions.push({
        label: qualified,
        kind: CompletionKind.Class,
        insertText: qualified.includes(' ') ? `"${qualified}"` : qualified,
        range,
        detail: 'Table',
      });
    }
    if (!afterFromOrJoin) {
      for (const c of t.columns || []) {
        const colName = typeof c === 'object' ? (c.name || c.column_name) : c;
        if (colName && (!lower || String(colName).toLowerCase().includes(lower))) {
          const insert = String(colName).includes(' ') ? `"${colName}"` : colName;
          suggestions.push({ label: colName, kind: CompletionKind.Field, insertText: insert, range, detail: 'Column' });
        }
      }
    }
  }

  // 4) Jinja placeholders and templates
  if (wantsJinja || lower === '' || lower === '{{') {
    for (const p of JINJA_PLACEHOLDERS) {
      suggestions.push({
        label: p.label,
        kind: CompletionKind.Snippet,
        insertText: p.insertText,
        range,    
        detail: p.detail,
      });
    }
    suggestions.push({
      label: 'Template: SELECT * FROM {{ table }} LIMIT 100',
      kind: CompletionKind.Snippet,
      insertText: 'SELECT * FROM {{ table }} LIMIT 100',
      range,
      detail: 'Jinja template',
    });
  }

  // 5) Schema-specific snippets (first table from data source)
  if (tables.length) {
    const first = tables[0];
    const firstTable = first?.name || first?.table_name || 'data';
    const firstQual = first?.schema && first?.schema !== 'public' ? `${first.schema}.${firstTable}` : firstTable;
    const firstCols = (first?.columns || [])
      .slice(0, 5)
      .map((c) => (typeof c === 'object' ? (c as { name?: string; column_name?: string }).name || (c as { name?: string; column_name?: string }).column_name : c))
      .filter(Boolean)
      .join(', ');
    suggestions.push({
      label: `Template: SELECT * FROM ${firstQual} LIMIT 100`,
      kind: CompletionKind.Snippet,
      insertText: `SELECT * FROM ${firstQual} LIMIT 100`,
      range,
      detail: 'Snippet from your schema',
    });
    if (firstCols) {
      suggestions.push({
        label: `Template: SELECT ${firstCols} FROM ${firstQual}`,
        kind: CompletionKind.Snippet,
        insertText: `SELECT ${firstCols} FROM ${firstQual}`,
        range,
        detail: 'Snippet from your schema',
      });
    }
  }

  return suggestions;
}

/** SQL language configuration for Monaco (comments, brackets, auto-closing including Jinja {{ }}) */
export const SQL_LANGUAGE_CONFIG: {
  comments: { lineComment: string; blockComment: [string, string] };
  brackets: [string, string][];
  autoClosingPairs: Array<{ open: string; close: string }>;
  surroundingPairs: Array<{ open: string; close: string }>;
} = {
  comments: {
    lineComment: '--',
    blockComment: ['/*', '*/'],
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
    ['"', '"'],
    ["'", "'"],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '{{', close: '}}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '{{', close: '}}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};
