// Ported from ../aicser/client/src/components/prep/CodeViews.tsx @ 749d38d (see PORTING.md). UI rewritten;
// js-yaml → `yaml` (already a dependency, used by pipelines).
import { useState } from 'react';
import { toast } from 'sonner';
import { parse, stringify } from 'yaml';
import { Button } from '@/components/aicser-ui/button';
import { Textarea } from '@/components/aicser-ui/textarea';
import type { PrepStep } from '@/api/prep';
import { tPrep as t } from '@/lib/prep/i18n';

/** The same recipe as YAML (editable, the format pipelines use). */
export function YamlView({
  steps,
  readOnly,
  onApply,
}: {
  steps: PrepStep[];
  readOnly: boolean;
  onApply: (steps: PrepStep[]) => void;
}) {
  const [text, setText] = useState(() => stringify({ steps }, { lineWidth: 120 }));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    let parsed: unknown;
    try {
      parsed = parse(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    const list = (parsed as { steps?: unknown } | null)?.steps;
    if (
      !Array.isArray(list) ||
      !list.every((s) => s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length === 1)
    ) {
      setError(t('code_must_be_list'));
      return;
    }
    setError(null);
    onApply(list as PrepStep[]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="text-sm text-muted-foreground">{t('yaml_hint')}</p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-80 flex-1 font-mono text-xs"
        spellCheck={false}
        readOnly={readOnly}
        aria-label={t('view_yaml')}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!readOnly && (
        <Button className="self-start" onClick={apply}>
          {t('apply')}
        </Button>
      )}
    </div>
  );
}

/** The SQL the steps compile to, plus a custom SQL step for anything the steps can't express. */
export function SqlView({
  sql,
  readOnly,
  onAddSqlStep,
}: {
  sql: string | null;
  readOnly: boolean;
  onAddSqlStep: (query: string) => void;
}) {
  const [custom, setCustom] = useState('SELECT *\nFROM {input}');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql ?? '');
      toast.success(t('copied'));
    } catch {
      toast.info(t('copy_failed'));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">{t('sql_hint')}</p>
        <Button size="sm" variant="outline" onClick={() => void copy()} disabled={!sql}>
          {t('copy')}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
        {sql}
      </pre>
      {!readOnly && (
        <>
          <p className="text-sm font-medium">{t('custom_sql_step')}</p>
          <p className="text-sm text-muted-foreground">{t('custom_sql_hint')}</p>
          <Textarea
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            rows={5}
            className="font-mono text-xs"
            spellCheck={false}
            aria-label={t('custom_sql_step')}
          />
          <Button
            variant="outline"
            className="self-start"
            onClick={() => onAddSqlStep(custom)}
            disabled={!custom.includes('{input}')}
          >
            {t('add_sql_step')}
          </Button>
        </>
      )}
    </div>
  );
}
