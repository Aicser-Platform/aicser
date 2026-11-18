// Ported from ../aicser/client/src/components/prep/FormulaEditor.tsx @ 749d38d (see PORTING.md). UI rewritten.
import { useEffect, useState } from 'react';
import { Textarea } from '@/components/aicser-ui/textarea';
import { checkFormula } from '@/api/prep';
import { tPrep as t } from '@/lib/prep/i18n';
import { Chip, Segmented } from './controls';

const FUNCTION_HINTS: Record<'excel' | 'sql', string[]> = {
  excel: [
    'IF',
    'IFS',
    'AND',
    'OR',
    'ISBLANK',
    'LEFT',
    'RIGHT',
    'MID',
    'LEN',
    'PROPER',
    'TRIM',
    'SUBSTITUTE',
    'CONCAT',
    'TEXT',
    'VALUE',
    'ROUND',
    'YEAR',
    'MONTH',
    'DATE',
    'DATEDIF',
    'EOMONTH',
    'TODAY',
  ],
  sql: [
    'CASE WHEN',
    'COALESCE',
    'NULLIF',
    'upper',
    'lower',
    'substr',
    'strpos',
    'replace',
    'regexp_extract',
    'round',
    'date_diff',
    'date_trunc',
    'strftime',
    'TRY_CAST',
  ],
};

/**
 * One formula box in two spellings. Spreadsheet formulas read like Sheets (=IF([Amount] > 100, "High", "Low"));
 * SQL is passed through after the server's safety check.
 */
export function FormulaEditor({
  value,
  language,
  onChange,
  onLanguageChange,
  columns,
  onValidity,
}: {
  value: string;
  language: 'excel' | 'sql';
  onChange: (next: string) => void;
  onLanguageChange: (next: 'excel' | 'sql') => void;
  columns: string[];
  onValidity: (ok: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const columnKey = columns.join('\u0000');

  useEffect(() => {
    if (!value.trim()) {
      onValidity(false);
      return undefined;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      checkFormula(value, language, columnKey ? columnKey.split('\u0000') : [])
        .then((res) => {
          if (cancelled) return;
          setError(res.ok ? null : (res.error ?? t('formula_invalid')));
          onValidity(res.ok);
        })
        .catch(() => {
          if (cancelled) return;
          setError(t('formula_invalid'));
          onValidity(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [value, language, columnKey, onValidity]);

  const insert = (snippet: string) => onChange(value ? `${value}${value.endsWith(' ') ? '' : ' '}${snippet}` : snippet);
  const columnToken = (c: string) => (language === 'excel' ? `[${c}]` : `"${c.replace(/"/g, '""')}"`);

  return (
    <div className="flex flex-col gap-2">
      <Segmented
        size="xs"
        label={t('formula')}
        value={language}
        onChange={onLanguageChange}
        options={[
          { value: 'excel', label: t('formula_excel') },
          { value: 'sql', label: t('formula_sql') },
        ]}
      />
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="font-mono text-xs"
        placeholder={language === 'excel' ? t('formula_excel_placeholder') : t('formula_sql_placeholder')}
        spellCheck={false}
        aria-label={t('formula')}
      />
      {error && value.trim() && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div>
        <p className="text-xs text-muted-foreground">{t('formula_columns')}</p>
        <div className="mt-1 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {columns.map((c) => (
            <Chip key={c} onClick={() => insert(columnToken(c))}>
              {c}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{t('formula_functions')}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {FUNCTION_HINTS[language].map((f) => (
            <Chip key={f} onClick={() => insert(language === 'excel' ? `${f}(` : f)}>
              {f}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
