// Ported from ../aicser/client/src/components/prep/StepList.tsx @ 749d38d (see PORTING.md). UI rewritten
// (web's collapsible SidePanel → a fixed column).
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Database,
  Eye,
  EyeOff,
  ListOrdered,
  Pencil,
  Redo2,
  Undo2,
  X,
} from 'lucide-react';
import { Button } from '@/components/aicser-ui/button';
import type { PrepStep, StepStat } from '@/api/prep';
import { tPrep as t } from '@/lib/prep/i18n';
import { isDisabled, stepSentence } from '@/lib/prep/stepText';
import { cn } from '@/lib/ui/utils';
import { Tag } from './controls';

export function StepList({
  steps,
  table,
  selected,
  stats,
  errorAt,
  readOnly,
  canUndo,
  canRedo,
  onSelect,
  onEdit,
  onToggle,
  onMove,
  onRemove,
  onUndo,
  onRedo,
  onShowFailures,
}: {
  steps: PrepStep[];
  table: string;
  selected: number | null;
  stats: StepStat[];
  errorAt: (i: number) => string | undefined;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSelect: (i: number | null) => void;
  onEdit: (i: number) => void;
  onToggle: (i: number) => void;
  onMove: (i: number, delta: -1 | 1) => void;
  onRemove: (i: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onShowFailures: (step: number, column: string) => void;
}) {
  const statFor = (i: number) => stats.find((s) => s.step === i);

  return (
    <aside aria-label={t('applied_steps')} className="flex w-64 shrink-0 flex-col border-r bg-card/40">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <ListOrdered className="size-4 text-primary" aria-hidden="true" />
        <h3 className="flex-1 text-sm font-semibold">
          {t('applied_steps')} <span className="font-normal text-muted-foreground">{steps.length}</span>
        </h3>
        {!readOnly && (
          <>
            <Button
              size="icon-xs"
              variant="ghost"
              title={t('undo')}
              aria-label={t('undo')}
              disabled={!canUndo}
              onClick={onUndo}
            >
              <Undo2 />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              title={t('redo')}
              aria-label={t('redo')}
              disabled={!canRedo}
              onClick={onRedo}
            >
              <Redo2 />
            </Button>
          </>
        )}
      </header>
      <ol aria-label={t('applied_steps')} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        <li>
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
              selected === -1 && 'bg-primary/10 font-medium'
            )}
            onClick={() => onSelect(-1)}
            title={t('step_source', { table })}
          >
            <Database className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{t('step_source', { table })}</span>
          </button>
        </li>
        {steps.map((step, i) => {
          const err = errorAt(i);
          const active = selected === i || (selected === null && i === steps.length - 1);
          const off = isDisabled(step);
          const stat = statFor(i);
          const sentence = stepSentence(step, t);
          return (
            <li
              key={i}
              className={cn(
                'group rounded-md',
                active && 'bg-primary/10',
                err && 'ring-1 ring-destructive/50',
                off && 'opacity-60'
              )}
            >
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => onSelect(i)}
                title={sentence}
              >
                {err ? (
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-label={err} />
                ) : (
                  <span className="mt-0.5 w-3.5 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                )}
                <span className={cn('line-clamp-2', off && 'line-through')}>{sentence}</span>
              </button>
              {stat && !off && (stat.rows_delta || stat.added?.length || Object.keys(stat.emptied ?? {}).length) ? (
                <div className="flex flex-wrap gap-1 px-2 pb-1 pl-7">
                  {stat.rows_delta ? <Tag tone="warn">{t('stat_rows', { delta: stat.rows_delta })}</Tag> : null}
                  {stat.added?.length ? <Tag tone="good">{t('stat_added', { count: stat.added.length })}</Tag> : null}
                  {Object.entries(stat.emptied ?? {}).map(([col, n]) => (
                    <Tag key={col} tone="bad" onClick={() => onShowFailures(i, col)}>
                      {t('stat_emptied', { count: n, column: col })}
                    </Tag>
                  ))}
                </div>
              ) : null}
              {!readOnly && (
                <div className="hidden gap-0.5 px-2 pb-1 pl-7 group-focus-within:flex group-hover:flex">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t('edit_step')}
                    title={t('edit_step')}
                    onClick={() => onEdit(i)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={off ? t('turn_on') : t('turn_off')}
                    title={off ? t('turn_on') : t('turn_off')}
                    onClick={() => onToggle(i)}
                  >
                    {off ? <EyeOff /> : <Eye />}
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t('move_up')}
                    title={t('move_up')}
                    disabled={i === 0}
                    onClick={() => onMove(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t('move_down')}
                    title={t('move_down')}
                    disabled={i === steps.length - 1}
                    onClick={() => onMove(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t('remove_step')}
                    title={t('remove_step')}
                    onClick={() => onRemove(i)}
                  >
                    <X />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {steps.length === 0 && <p className="px-3 pb-3 text-xs text-muted-foreground">{t('no_steps_hint')}</p>}
    </aside>
  );
}
