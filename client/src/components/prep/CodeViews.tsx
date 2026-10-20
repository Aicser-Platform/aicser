'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Space, Typography, message } from 'antd';
import * as yaml from 'js-yaml';
import type { PrepStep } from '@/api/prep';

const { Text } = Typography;

/** The same recipe as YAML (editable, the format pipelines use). */
export function YamlView({ steps, readOnly, onApply }: { steps: PrepStep[]; readOnly: boolean; onApply: (steps: PrepStep[]) => void }) {
  const t = useTranslations('prepare');
  const [text, setText] = useState(() => yaml.dump({ steps }, { lineWidth: 120, noRefs: true }));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    let parsed: unknown;
    try {
      parsed = yaml.load(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    const list = (parsed as { steps?: unknown })?.steps;
    if (!Array.isArray(list) || !list.every((s) => s && typeof s === 'object' && Object.keys(s).length === 1)) {
      setError(t('code_must_be_list'));
      return;
    }
    setError(null);
    onApply(list as PrepStep[]);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Text type="secondary">{t('yaml_hint')}</Text>
      <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} rows={22} className="recipe-editor__code" spellCheck={false} readOnly={readOnly} aria-label={t('view_yaml')} />
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {!readOnly ? (
        <Button type="primary" onClick={apply}>
          {t('apply')}
        </Button>
      ) : null}
    </Space>
  );
}

/** The SQL the steps compile to, plus a custom SQL step for anything the steps can't express. */
export function SqlView({ sql, readOnly, onAddSqlStep }: { sql: string | null; readOnly: boolean; onAddSqlStep: (query: string) => void }) {
  const t = useTranslations('prepare');
  const [custom, setCustom] = useState('SELECT *\nFROM {input}');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql ?? '');
      message.success(t('copied'));
    } catch {
      message.info(t('copy_failed'));
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Space>
        <Text type="secondary">{t('sql_hint')}</Text>
        <Button size="small" onClick={() => void copy()} disabled={!sql}>
          {t('copy')}
        </Button>
      </Space>
      <pre className="recipe-editor__code recipe-editor__sql">{sql}</pre>
      {!readOnly ? (
        <>
          <Text strong>{t('custom_sql_step')}</Text>
          <Text type="secondary">{t('custom_sql_hint')}</Text>
          <Input.TextArea value={custom} onChange={(e) => setCustom(e.target.value)} rows={5} className="recipe-editor__code" spellCheck={false} aria-label={t('custom_sql_step')} />
          <Button onClick={() => onAddSqlStep(custom)} disabled={!custom.includes('{input}')}>
            {t('add_sql_step')}
          </Button>
        </>
      ) : null}
    </Space>
  );
}
