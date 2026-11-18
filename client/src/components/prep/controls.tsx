// Small controls the Prepare forms share (web used AntD Segmented, Radio.Button, Select mode="multiple", Tag).
import { Check, ChevronDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/aicser-ui/button';
import { Checkbox } from '@/components/aicser-ui/checkbox';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/aicser-ui/popover';
import { cn } from '@/lib/ui/utils';

/** One choice from a few, as a row of buttons (AntD Segmented / Radio.Button). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (next: T) => void;
  label: string;
  size?: 'xs' | 'sm';
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={cn(
            'rounded-md px-2.5 text-muted-foreground hover:text-foreground',
            size === 'xs' ? 'py-0.5 text-xs' : 'py-1 text-sm',
            value === o.value && 'bg-background font-medium text-foreground shadow-sm'
          )}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A labelled form row (web `Space direction="vertical"` + `Text strong`). */
export function FormRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label?: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
      )}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One column (or another value) from a list; `allowEmpty` adds a blank first choice. */
export function ColumnSelect({
  value,
  options,
  onChange,
  label,
  placeholder,
  allowEmpty = false,
  warn = false,
  className,
  id,
}: {
  value: string | undefined;
  options: string[];
  onChange: (next: string | undefined) => void;
  label: string;
  placeholder?: string;
  allowEmpty?: boolean;
  warn?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <NativeSelect
      id={id}
      aria-label={label}
      aria-invalid={warn || undefined}
      className={cn('w-full', className)}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      {(allowEmpty || !value) && <NativeSelectOption value="">{placeholder ?? '—'}</NativeSelectOption>}
      {options.map((c) => (
        <NativeSelectOption key={c} value={c}>
          {c}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Several columns, in the order picked (AntD Select mode="multiple"). */
export function ColumnMulti({
  value,
  options,
  onChange,
  label,
  min = 1,
}: {
  value: string[] | undefined;
  options: string[];
  onChange: (next: string[]) => void;
  label: string;
  min?: number;
}) {
  const picked = value ?? [];
  const listId = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={label}
          aria-invalid={picked.length < min || undefined}
          className="h-auto min-h-8 w-full justify-between py-1 font-normal"
        >
          <span className="flex min-w-0 flex-wrap gap-1">
            {picked.length ? (
              picked.map((c) => (
                <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {c}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">Choose columns…</span>
            )}
          </span>
          <ChevronDown className="shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-(--radix-popover-trigger-width) overflow-y-auto p-1">
        <ul id={listId} aria-label={label} className="flex flex-col">
          {options.map((c) => {
            const on = picked.includes(c);
            return (
              <li key={c}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                  <Checkbox
                    checked={on}
                    onCheckedChange={(next) => onChange(next ? [...picked, c] : picked.filter((x) => x !== c))}
                  />
                  <span className="truncate">{c}</span>
                </label>
              </li>
            );
          })}
          {!options.length && <li className="px-2 py-1 text-sm text-muted-foreground">No columns.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** A clickable choice that shows whether it is on (AntD Tag.CheckableTag), or a plain insert chip. */
export function Chip({
  checked,
  onClick,
  children,
  title,
}: {
  checked?: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={checked}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:border-primary/60',
        checked && 'border-primary bg-primary/10 text-foreground'
      )}
      onClick={onClick}
    >
      {checked && <Check className="size-3" aria-hidden="true" />}
      {children}
    </button>
  );
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'new';
const TONE: Record<Tone, string> = {
  neutral: 'border-border text-muted-foreground',
  good: 'border-(--status-good)/40 text-(--status-good)',
  warn: 'border-(--layer-bronze)/40 text-(--layer-bronze)',
  bad: 'border-destructive/40 text-destructive',
  info: 'border-(--status-busy)/40 text-(--status-busy)',
  new: 'border-(--status-good)/40 bg-(--status-good)/10 text-(--status-good)',
};

/** A small status word (AntD Tag): tone plus text, never colour alone. */
export function Tag({
  tone = 'neutral',
  children,
  title,
  onClick,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  const cls = cn(
    'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs whitespace-nowrap',
    TONE[tone]
  );
  return onClick ? (
    <button type="button" title={title} className={cn(cls, 'hover:underline')} onClick={onClick}>
      {children}
    </button>
  ) : (
    <span title={title} className={cls}>
      {children}
    </span>
  );
}
