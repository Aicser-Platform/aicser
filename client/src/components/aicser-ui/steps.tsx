'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/ui/utils';

export type StepItem = {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
};

/**
 * A horizontal progress of steps (replaces AntD Steps): done steps show a check, the current one is filled, lines join
 * them. With `onChange`, steps are buttons (jump to a step, e.g. while editing).
 */
function Steps({
  items,
  current,
  onChange,
  className,
}: {
  items: StepItem[];
  current: number;
  onChange?: (index: number) => void;
  className?: string;
}) {
  return (
    <ol className={cn('m-0 flex list-none items-start gap-2 p-0', className)}>
      {items.map((item, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo';
        const marker = (
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium [&_svg]:size-4',
              state === 'done' && 'border-primary bg-primary/15 text-primary-hover dark:text-primary',
              state === 'current' && 'border-primary bg-primary text-primary-foreground',
              state === 'todo' && 'border-input text-muted-foreground'
            )}
            aria-hidden
          >
            {state === 'done' ? <Check /> : (item.icon ?? index + 1)}
          </span>
        );
        const text = (
          <span className="flex min-w-0 flex-col text-left">
            <span className={cn('truncate text-sm font-medium', state === 'todo' && 'text-muted-foreground')}>{item.title}</span>
            {item.description ? <span className="truncate text-xs text-muted-foreground">{item.description}</span> : null}
          </span>
        );
        const clickable = Boolean(onChange) && !item.disabled && index !== current;
        return (
          <li key={index} className="flex min-w-0 flex-1 items-start gap-2 last:flex-none" aria-current={state === 'current' ? 'step' : undefined}>
            {clickable ? (
              <button
                type="button"
                onClick={() => onChange?.(index)}
                className="flex min-w-0 items-start gap-2.5 rounded-md border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {marker}
                {text}
              </button>
            ) : (
              <span className={cn('flex min-w-0 items-start gap-2.5', item.disabled && 'opacity-60')}>
                {marker}
                {text}
              </span>
            )}
            {index < items.length - 1 ? (
              <span className={cn('mt-4 hidden h-px min-w-6 flex-1 sm:block', index < current ? 'bg-primary' : 'bg-border')} aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export { Steps };
