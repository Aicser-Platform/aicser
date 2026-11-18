'use client';

import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/ui/utils';

export type ComboboxOption = {
  value: string;
  label: string;
  /** A second line (a category, a type). */
  description?: string;
  /** Shown before the label (a logo, an icon). */
  icon?: React.ReactNode;
  /** Groups the list under this heading. */
  group?: string;
  disabled?: boolean;
  /** Extra words the search matches. */
  keywords?: string;
};

/**
 * A searchable select (replaces AntD Select showSearch): a button showing the choice, a popover with a search box and
 * the options, grouped when they have `group`. ↑/↓ move, Enter picks, Escape closes.
 */
function Combobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = 'Search…',
  emptyText = 'No results.',
  disabled,
  className,
  size = 'default',
  'aria-label': ariaLabel,
  id,
}: {
  value?: string | null;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'default' | 'lg';
  'aria-label'?: string;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const selected = options.find((o) => o.value === value);

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.description ?? ''} ${o.group ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);
  const enabled = shown.filter((o) => !o.disabled);

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    const at = enabled.findIndex((o) => o.value === value);
    setActive(Math.max(0, at));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when it opens
  }, [open]);

  const pick = (option: ComboboxOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  // Options in display order, with group headings where the group changes.
  const rows: ({ kind: 'group'; label: string } | { kind: 'option'; option: ComboboxOption })[] = [];
  let lastGroup: string | undefined;
  for (const option of shown) {
    if (option.group && option.group !== lastGroup) rows.push({ kind: 'group', label: option.group });
    lastGroup = option.group;
    rows.push({ kind: 'option', option });
  }
  const activeValue = enabled[active]?.value;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={ariaLabel}
          className={cn(
            'flex w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30',
            size === 'sm' ? 'h-7' : size === 'lg' ? 'h-10' : 'h-8',
            className
          )}
        >
          {selected?.icon ? <span className="flex shrink-0 items-center [&_svg]:size-4">{selected.icon}</span> : null}
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <div className="aicser-ui">
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            className="z-[1050] flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[max(20rem,var(--radix-popover-trigger-width))] flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md outline-none ring-1 ring-foreground/10"
          >
            <div className="flex items-center gap-2 border-b px-2.5">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                autoFocus
                value={query}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                aria-controls={listId}
                aria-activedescendant={activeValue ? `${listId}-${activeValue}` : undefined}
                className="h-9 w-full min-w-0 border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (!enabled.length) return;
                    setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : enabled.length - 1)) % enabled.length);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const option = enabled[active];
                    if (option) pick(option);
                  }
                }}
              />
            </div>
            <ul id={listId} role="listbox" className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-1">
              {rows.length === 0 ? <li className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyText}</li> : null}
              {rows.map((row, index) =>
                row.kind === 'group' ? (
                  <li key={`g-${row.label}-${index}`} role="presentation" className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    {row.label}
                  </li>
                ) : (
                  <li
                    key={row.option.value}
                    id={`${listId}-${row.option.value}`}
                    role="option"
                    aria-selected={row.option.value === value}
                    aria-disabled={row.option.disabled || undefined}
                    data-active={row.option.value === activeValue || undefined}
                    className={cn(
                      'flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none data-[active]:bg-accent data-[active]:text-accent-foreground',
                      row.option.disabled && 'cursor-not-allowed opacity-50'
                    )}
                    onMouseEnter={() => {
                      const at = enabled.indexOf(row.option);
                      if (at >= 0) setActive(at);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(row.option)}
                  >
                    {row.option.icon ? <span className="flex w-5 shrink-0 justify-center [&_svg]:size-4">{row.option.icon}</span> : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{row.option.label}</span>
                      {row.option.description ? <span className="truncate text-xs text-muted-foreground">{row.option.description}</span> : null}
                    </span>
                    {row.option.value === value ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                  </li>
                )
              )}
            </ul>
          </PopoverPrimitive.Content>
        </div>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export { Combobox };
