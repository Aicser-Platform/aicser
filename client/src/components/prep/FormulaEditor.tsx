'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Input, Segmented, Space, Tag, Typography } from 'antd';
import { checkFormula } from '@/api/prep';

const { Text } = Typography;

const FUNCTION_HINTS: Record<'excel' | 'sql', string[]> = {
  excel: ['IF', 'IFS', 'AND', 'OR', 'ISBLANK', 'LEFT', 'RIGHT', 'MID', 'LEN', 'PROPER', 'TRIM', 'SUBSTITUTE', 'CONCAT', 'TEXT', 'VALUE', 'ROUND', 'YEAR', 'MONTH', 'DATE', 'DATEDIF', 'EOMONTH', 'TODAY'],
  sql: ['CASE WHEN', 'COALESCE', 'NULLIF', 'upper', 'lower', 'substr', 'strpos', 'replace', 'regexp_extract', 'round', 'date_diff', 'date_trunc', 'strftime', 'TRY_CAST'],
};

/**
 * One formula box in two spellings. Spreadsheet formulas read like Sheets
 * (=IF([Amount] > 100, "High", "Low")); SQL is passed through after a safety check.
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
  onValidity?: (ok: boolean) => void;
}) {
  const t = useTranslations('prepare');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!value.trim()) {
      onValidity?.(false);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await checkFormula(value, language, columns);
        setError(res.ok ? null : res.error ?? t('formula_invalid'));
        onValidity?.(res.ok);
      } catch {
        setError(t('formula_invalid'));
        onValidity?.(false);
      }
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, language, columns.join('\u0000')]);

  const insert = (snippet: string) => onChange(value ? `${value}${value.endsWith(' ') ? '' : ' '}${snippet}` : snippet);
  const columnToken = (c: string) => (language === 'excel' ? `[${c}]` : `"${c.replace(/"/g, '""')}"`);

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Segmented
        size="small"
        value={language}
        onChange={(v) => onLanguageChange(v as 'excel' | 'sql')}
        options={[
          { value: 'excel', label: t('formula_excel') },
          { value: 'sql', label: t('formula_sql') },
        ]}
      />
      <Input.TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="recipe-editor__code"
        placeholder={language === 'excel' ? t('formula_excel_placeholder') : t('formula_sql_placeholder')}
        spellCheck={false}
        aria-label={t('formula')}
      />
      {error && value.trim() ? <Alert type="error" showIcon message={error} /> : null}
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('formula_columns')}
        </Text>
        <div className="recipe-editor__chips">
          {columns.map((c) => (
            <Tag key={c} className="recipe-editor__chip" onClick={() => insert(columnToken(c))}>
              {c}
            </Tag>
          ))}
        </div>
      </div>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('formula_functions')}
        </Text>
        <div className="recipe-editor__chips">
          {FUNCTION_HINTS[language].map((f) => (
            <Tag key={f} className="recipe-editor__chip" onClick={() => insert(language === 'excel' ? `${f}(` : f)}>
              {f}
            </Tag>
          ))}
        </div>
      </div>
    </Space>
  );
}
