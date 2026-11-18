// Ported from ../aicser/client/src/components/prep/CleanPanel.tsx @ 749d38d (see PORTING.md). UI rewritten; the
// report is saved with the native Save dialog (Rust `save_file`) instead of a browser download.
/**
 * The CLEAN panel beside the Prepare grid, one tab per stage of cleaning a dataset: Conceptualize (what the data
 * is), Locate (issues with a ready fix), Evaluate (issues a person must judge: keep, exclude or note), Augment (add
 * to the data) and Note (the cleaning report).
 */
import { Check, Copy, Download, Pencil } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type {
  CleaningDecision,
  CleaningLog,
  ColumnDistribution,
  ColumnMeaning,
  Finding,
  PrepStep,
  PreviewColumn,
} from '@/api/prep';
import { Button } from '@/components/aicser-ui/button';
import { Textarea } from '@/components/aicser-ui/textarea';
import { saveFile } from '@/lib/desktop/files';
import { decisionKey } from '@/lib/prep/clean';
import { tClean as t, tPrep as tp } from '@/lib/prep/i18n';
import { friendlyType } from '@/lib/prep/recipeSteps';
import { cn } from '@/lib/ui/utils';
import { Tag } from './controls';

type CleanStage = 'c' | 'l' | 'e' | 'a' | 'n';
const STAGES: CleanStage[] = ['c', 'l', 'e', 'a', 'n'];

export type AugmentAction = {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  needsColumn?: boolean;
};

const small = 'text-xs text-muted-foreground';

export function CleanPanel({
  name,
  table,
  rowCount,
  sampled,
  columns,
  dists,
  findings,
  loading,
  error,
  readOnly,
  columnMeta,
  cleaning,
  onCleaningChange,
  stepSentences,
  findingText,
  augment,
  hasSelection,
  onApply,
  onApplyAll,
  onSelectColumn,
  onMeaning,
  onExclude,
}: {
  name: string;
  table: string;
  rowCount?: number;
  sampled?: boolean;
  columns: PreviewColumn[];
  dists: Record<string, ColumnDistribution>;
  findings: Finding[];
  loading: boolean;
  error?: string | null;
  readOnly: boolean;
  columnMeta?: Record<string, ColumnMeaning> | null;
  cleaning?: CleaningLog | null;
  /** Absent when decisions and notes can't be saved here (read-only). */
  onCleaningChange?: (log: CleaningLog) => Promise<void>;
  stepSentences: string[];
  findingText: (f: Finding) => string;
  augment: AugmentAction[];
  hasSelection: boolean;
  onApply: (step: PrepStep) => void;
  onApplyAll: () => void;
  onSelectColumn: (column: string) => void;
  onMeaning?: (column: string) => void;
  onExclude: (column: string) => void;
}) {
  const fixable = findings.filter((f) => f.suggested_step);
  const review = findings.filter((f) => !f.suggested_step);
  const decisions = cleaning?.decisions ?? {};
  const open = review.filter((f) => !decisions[decisionKey(f)]);
  const [stage, setStage] = useState<CleanStage>('c');
  const counts: Partial<Record<CleanStage, number>> = { l: fixable.length, e: open.length };

  const saveLog = async (next: CleaningLog) => {
    if (!onCleaningChange) return;
    try {
      await onCleaningChange(next);
    } catch {
      toast.error(t('save_failed'));
    }
  };
  const decide = (f: Finding, decision: CleaningDecision | null) => {
    const rest = { ...decisions };
    delete rest[decisionKey(f)];
    void saveLog({ ...(cleaning ?? {}), decisions: decision ? { ...rest, [decisionKey(f)]: decision } : rest });
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label={t('title')} className="grid grid-cols-5 gap-0.5 rounded-lg bg-muted p-0.5">
        {STAGES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={stage === s}
            title={t(`stage_${s}`)}
            aria-label={t(`stage_${s}`)}
            className={cn(
              'relative rounded-md py-1 text-sm font-semibold text-muted-foreground',
              stage === s && 'bg-background text-foreground shadow-sm'
            )}
            onClick={() => setStage(s)}
          >
            {s.toUpperCase()}
            {counts[s] ? <sup className="ml-0.5 text-[10px] text-primary-active">{counts[s]}</sup> : null}
          </button>
        ))}
      </div>
      <div>
        <p className="text-sm font-medium">{t(`stage_${stage}`)}</p>
        <p className={small}>{t(`stage_${stage}_hint`)}</p>
      </div>

      {error && <p className={small}>{tp('suggestions_after_fix')}</p>}
      {loading && !findings.length && !columns.length && <p className={small}>{tp('checking_data')}</p>}

      {stage === 'c' && (
        <Conceptualize
          rowCount={rowCount}
          sampled={sampled}
          columns={columns}
          dists={dists}
          columnMeta={columnMeta}
          onSelectColumn={onSelectColumn}
          onMeaning={onMeaning}
        />
      )}

      {stage === 'l' && (
        <>
          {fixable.length > 1 && !readOnly && (
            <Button size="sm" variant="outline" className="self-start" onClick={onApplyAll}>
              {tp('apply_all', { count: fixable.length })}
            </Button>
          )}
          {!fixable.length && !loading && !error && <p className={small}>{t('nothing_to_fix')}</p>}
          <ul aria-label={t('stage_l')} className="flex flex-col divide-y">
            {fixable.map((f) => (
              <li key={decisionKey(f)} className="flex items-start gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{findingText(f)}</p>
                  {Array.isArray(f.params.failing) && (f.params.failing as string[]).length ? (
                    <p className={small}>
                      {tp('still_unread', { values: (f.params.failing as string[]).slice(0, 3).join(' · ') })}
                    </p>
                  ) : null}
                </div>
                {!readOnly && f.suggested_step && (
                  <Button size="sm" variant="outline" onClick={() => onApply(f.suggested_step as PrepStep)}>
                    {tp('apply')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {stage === 'e' && (
        <>
          {!review.length && !loading && !error && <p className={small}>{t('nothing_to_review')}</p>}
          <ul aria-label={t('stage_e')} className="flex flex-col gap-2">
            {review.map((f) => {
              const decision = decisions[decisionKey(f)];
              return (
                <ReviewItem
                  key={`${decisionKey(f)}|${decision?.action ?? ''}|${decision?.reason ?? ''}`}
                  text={findingText(f)}
                  finding={f}
                  decision={decision}
                  canDecide={Boolean(onCleaningChange)}
                  canExclude={!readOnly && Boolean(f.column)}
                  onDecide={(d) => decide(f, d)}
                  onExclude={() => {
                    if (f.column) onExclude(f.column);
                    decide(f, { action: 'exclude', reason: decision?.reason ?? null });
                  }}
                  onShow={() => f.column && onSelectColumn(f.column)}
                />
              );
            })}
          </ul>
        </>
      )}

      {stage === 'a' && (
        <div className="flex flex-col gap-1.5">
          {augment.map((a) => {
            const blocked = a.needsColumn && !hasSelection;
            return (
              <Button
                key={a.key}
                variant="outline"
                className="justify-start"
                title={blocked ? t('select_column_first') : undefined}
                disabled={readOnly || blocked}
                onClick={a.onClick}
              >
                {a.icon}
                {a.label}
              </Button>
            );
          })}
        </div>
      )}

      {stage === 'n' && (
        <Notes
          key={cleaning?.note ?? ''}
          name={name}
          table={table}
          stepSentences={stepSentences}
          review={review}
          decisions={decisions}
          findingText={findingText}
          columnMeta={columnMeta}
          note={cleaning?.note ?? ''}
          canEdit={Boolean(onCleaningChange)}
          onNote={(note) => void saveLog({ ...(cleaning ?? {}), decisions, note })}
        />
      )}
    </div>
  );
}

function Conceptualize({
  rowCount,
  sampled,
  columns,
  dists,
  columnMeta,
  onSelectColumn,
  onMeaning,
}: {
  rowCount?: number;
  sampled?: boolean;
  columns: PreviewColumn[];
  dists: Record<string, ColumnDistribution>;
  columnMeta?: Record<string, ColumnMeaning> | null;
  onSelectColumn: (column: string) => void;
  onMeaning?: (column: string) => void;
}) {
  const described = columns.filter((c) => columnMeta?.[c.name]?.description).length;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">{t('summary', { rows: rowCount ?? 0, columns: columns.length })}</p>
        {sampled && <Tag>{t('sampled')}</Tag>}
        <p className={small}>{t('described', { count: described, total: columns.length })}</p>
      </div>
      <ul aria-label={t('stage_c')} className="flex flex-col divide-y">
        {columns.map((col) => {
          const d = dists[col.name];
          const filled = d && d.rows ? Math.round(((d.rows - d.empty) / d.rows) * 100) : null;
          const meaning = columnMeta?.[col.name];
          return (
            <li key={col.name} className="flex flex-col gap-1 py-2">
              <button
                type="button"
                className="flex items-baseline justify-between gap-2 text-left"
                onClick={() => onSelectColumn(col.name)}
              >
                <span className="truncate text-sm font-medium">{col.name}</span>
                <span className={small}>{tp(`type_${friendlyType(col.type)}`)}</span>
              </button>
              {filled !== null && (
                <div
                  className="h-1 overflow-hidden rounded-full bg-destructive/40"
                  role="img"
                  aria-label={t('filled', { percent: filled })}
                >
                  <span className="block h-full bg-(--status-good)" style={{ width: `${filled}%` }} />
                </div>
              )}
              {d && <p className={cn(small, 'truncate')}>{columnShape(d, filled ?? 0)}</p>}
              {meaning?.description ? (
                <p className="text-xs">{meaning.description}</p>
              ) : onMeaning ? (
                <button
                  type="button"
                  className="self-start text-xs text-primary-active hover:underline"
                  onClick={() => onMeaning(col.name)}
                >
                  {t('add_meaning')}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function columnShape(dist: ColumnDistribution, filled: number): string {
  const unique = dist.distinct === dist.rows - dist.empty;
  const parts = [t('filled', { percent: filled }), unique ? t('unique') : t('distinct', { count: dist.distinct })];
  if (dist.kind === 'number' && dist.min != null && dist.max != null) {
    parts.push(t('range', { min: dist.min.toLocaleString(), max: dist.max.toLocaleString() }));
  } else if (dist.top?.[0] && dist.top[0].count > 1) {
    parts.push(t('most_common', { value: dist.top[0].value, count: dist.top[0].count }));
  }
  return parts.join(' · ');
}

function ReviewItem({
  text,
  finding,
  decision,
  canDecide,
  canExclude,
  onDecide,
  onExclude,
  onShow,
}: {
  text: string;
  finding: Finding;
  decision?: CleaningDecision;
  canDecide: boolean;
  canExclude: boolean;
  onDecide: (d: CleaningDecision | null) => void;
  onExclude: () => void;
  onShow: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState(decision?.reason ?? '');
  const examples = Array.isArray(finding.params.examples) ? (finding.params.examples as string[]) : [];
  const done = (d: CleaningDecision | null) => {
    onDecide(d);
    setEditing(false);
  };

  return (
    <li className={cn('flex flex-col gap-1.5 rounded-lg border p-2', decision && 'bg-muted/40')}>
      <button type="button" className="text-left text-sm" onClick={onShow}>
        {text}
      </button>
      {examples.length > 0 && <p className={small}>{t('examples', { values: examples.join(' · ') })}</p>}
      {decision && !editing ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag tone={decision.action === 'exclude' ? 'warn' : decision.action === 'keep' ? 'good' : 'info'}>
            <Check className="size-3" aria-hidden="true" />
            {t(`decision_${decision.action}`)}
          </Tag>
          {decision.reason && <span className="text-xs">{decision.reason}</span>}
          {canDecide && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t('change_decision')}
              title={t('change_decision')}
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
          )}
        </div>
      ) : canDecide ? (
        <>
          <Textarea
            rows={1}
            maxLength={500}
            className="min-h-8 text-xs"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('reason_placeholder')}
            aria-label={t('reason_placeholder')}
          />
          <div className="flex flex-wrap gap-1">
            <Button size="xs" variant="outline" onClick={() => done({ action: 'keep', reason: reason || null })}>
              {t('keep')}
            </Button>
            {canExclude && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  onExclude();
                  setEditing(false);
                }}
              >
                {t('exclude')}
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => done({ action: 'note', reason: reason || null })}>
              {t('note_only')}
            </Button>
            {decision && (
              <Button size="xs" variant="ghost" className="text-destructive" onClick={() => done(null)}>
                {t('clear_decision')}
              </Button>
            )}
          </div>
        </>
      ) : null}
    </li>
  );
}

function Notes({
  name,
  table,
  stepSentences,
  review,
  decisions,
  findingText,
  columnMeta,
  note,
  canEdit,
  onNote,
}: {
  name: string;
  table: string;
  stepSentences: string[];
  review: Finding[];
  decisions: Record<string, CleaningDecision>;
  findingText: (f: Finding) => string;
  columnMeta?: Record<string, ColumnMeaning> | null;
  note: string;
  canEdit: boolean;
  onNote: (note: string) => void;
}) {
  const [draft, setDraft] = useState(note);

  const decided = review.filter((f) => decisions[decisionKey(f)]);
  const open = review.filter((f) => !decisions[decisionKey(f)]);

  const report = useMemo(() => {
    const meanings = Object.entries(columnMeta ?? {}).filter(([, m]) => m.description);
    const lines = [`# ${t('report_title', { name })}`, '', t('report_source', { table }), ''];
    lines.push(`## ${t('report_steps')}`);
    lines.push(
      ...(stepSentences.length ? stepSentences.map((s, i) => `${i + 1}. ${s}`) : [`- ${t('report_none')}`]),
      ''
    );
    lines.push(`## ${t('report_decisions')}`);
    lines.push(
      ...(decided.length
        ? decided.map((f) => {
            const d = decisions[decisionKey(f)]!;
            return `- ${findingText(f)}: **${t(`decision_${d.action}`)}**${d.reason ? ` (${d.reason})` : ''}`;
          })
        : [`- ${t('report_none')}`])
    );
    if (open.length) lines.push('', `## ${t('report_open')}`, ...open.map((f) => `- ${findingText(f)}`));
    if (meanings.length)
      lines.push('', `## ${t('report_columns')}`, ...meanings.map(([c, m]) => `- **${c}**: ${m.description}`));
    if (draft.trim()) lines.push('', `## ${t('report_notes')}`, draft.trim());
    return lines.join('\n');
  }, [name, table, stepSentences, decided, open, decisions, findingText, columnMeta, draft]);

  const copy = () =>
    navigator.clipboard.writeText(report).then(
      () => toast.success(t('copied')),
      () => toast.error(t('copy_failed'))
    );
  const download = async () => {
    try {
      await saveFile(`${name.replace(/[^\w.-]+/g, '_') || 'cleaning'}-report.md`, new TextEncoder().encode(report));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <p className="text-sm">
        {t('report_counts', { steps: stepSentences.length, decided: decided.length, open: open.length })}
      </p>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== note && onNote(draft)}
        disabled={!canEdit}
        rows={4}
        maxLength={5000}
        placeholder={t('notes_placeholder')}
        aria-label={t('report_notes')}
      />
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          <Copy /> {t('copy_report')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void download()}>
          <Download /> {t('download_report')}
        </Button>
      </div>
      <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">
        {report}
      </pre>
    </>
  );
}
