'use client';

import * as React from 'react';
import { cn } from '@/lib/ui/utils';

export type MentionOption = { value: string; label: string };

type MentionTextareaProps = Omit<React.ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  /** People who can be mentioned: `value` is inserted after "@", `label` is shown in the list. */
  options: MentionOption[];
  /** Grows with its text between these row counts. */
  minRows?: number;
  maxRows?: number;
};

/** The "@word" just before the caret, if the caret is inside one. */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  return { start: caret - match[2].length - 1, query: match[2] };
}

/**
 * A textarea that suggests people when you type "@" (replaces AntD Mentions): ↑/↓ move, Enter or Tab picks,
 * Escape closes. Grows with its content.
 */
const MentionTextarea = React.forwardRef<HTMLTextAreaElement, MentionTextareaProps>(function MentionTextarea(
  { value, onChange, options, minRows = 2, maxRows = 8, className, onKeyDown, onBlur, ...props },
  forwardedRef
) {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const listId = React.useId();
  const [mention, setMention] = React.useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = React.useState(0);

  const setRef = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  // Grow with the text, between minRows and maxRows.
  React.useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 20;
    const padding =
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderBottomWidth);
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight + parseFloat(style.borderTopWidth) * 2, line * minRows + padding), line * maxRows + padding)}px`;
    el.style.overflowY = el.scrollHeight > line * maxRows + padding ? 'auto' : 'hidden';
  }, [value, minRows, maxRows]);

  const matches = React.useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return options.filter((o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)).slice(0, 8);
  }, [mention, options]);

  const update = (text: string, caret: number) => {
    onChange(text);
    setMention(mentionAt(text, caret));
    setActive(0);
  };

  const pick = (option: MentionOption) => {
    const el = innerRef.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? value.length;
    const insert = `@${option.value} `;
    const next = value.slice(0, mention.start) + insert + value.slice(caret);
    onChange(next);
    setMention(null);
    const at = mention.start + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at, at);
    });
  };

  const open = Boolean(mention && matches.length);

  return (
    <div className="relative w-full">
      <textarea
        ref={setRef}
        value={value}
        rows={minRows}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        className={cn(
          'block w-full min-w-0 resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        onChange={(event) => update(event.target.value, event.target.selectionStart ?? event.target.value.length)}
        onKeyDown={(event) => {
          if (open) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((i) => (i + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing) {
              event.preventDefault();
              pick(matches[active]);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setMention(null);
              return;
            }
          }
          onKeyDown?.(event);
        }}
        onClick={(event) => setMention(mentionAt(value, event.currentTarget.selectionStart ?? value.length))}
        onBlur={(event) => {
          // Let a click on a suggestion land first.
          window.setTimeout(() => setMention(null), 120);
          onBlur?.(event);
        }}
        {...props}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-full z-50 m-0 mt-1 max-h-60 w-64 max-w-full list-none overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {matches.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={index === active}
              className="cursor-default truncate rounded-md px-2 py-1.5 aria-selected:bg-accent aria-selected:text-accent-foreground"
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option);
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

export { MentionTextarea };
