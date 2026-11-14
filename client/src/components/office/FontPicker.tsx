'use client';

import { Check, ChevronDown, Minus, Plus } from 'lucide-react';
import { Fragment } from 'react';
import { Button } from '@/components/aicser-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/aicser-ui/dropdown-menu';
import { OFFICE_FONTS, fontStack } from '@/lib/office/fonts';
import { ToolButton } from './Toolbar';

// Font name + size controls shared by Sheets, Docs and Slides: one look (menu with English / Khmer groups, each
// font drawn in itself) and one behaviour everywhere.

const sameName = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

export function FontPicker({
  value,
  onChange,
  defaultLabel = 'Default',
  defaultFont,
  disabled,
  restoreFocus = true,
}: Readonly<{
  /** The font name in use (lib/sheets/fonts); null = the default. */
  value: string | null | undefined;
  /** A font name, or null for the default. */
  onChange: (name: string | null) => void;
  /** What the default is called ("Default", "Theme font"). */
  defaultLabel?: string;
  /** The font the default draws with (for the button's preview). */
  defaultFont?: string;
  disabled?: boolean;
  /** Give focus back to the button on close; false when a text editor takes it back itself. */
  restoreFocus?: boolean;
}>) {
  const shown = value || defaultLabel;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-32 justify-between gap-1 px-2 text-xs"
          aria-label={`Font: ${shown}`}
          disabled={disabled}
          style={{ fontFamily: fontStack(value || defaultFont) }}
        >
          <span className="truncate">{shown}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="max-h-96"
        align="start"
        onCloseAutoFocus={restoreFocus ? undefined : (e) => e.preventDefault()}
      >
        <DropdownMenuItem onSelect={() => onChange(null)}>
          {defaultLabel}
          {!value && <Check className="ml-auto" aria-label="Current" />}
        </DropdownMenuItem>
        {(['English', 'Khmer'] as const).map((group) => (
          <Fragment key={group}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{group}</DropdownMenuLabel>
            {OFFICE_FONTS.filter((f) => f.group === group).map((f) => (
              <DropdownMenuItem key={f.name} onSelect={() => onChange(f.name)}>
                <span style={{ fontFamily: f.stack }}>{f.name}</span>
                <span className="ml-auto pl-4 text-muted-foreground" style={{ fontFamily: f.stack }} aria-hidden="true">
                  {group === 'Khmer' ? 'សួស្តី' : 'Aa'}
                </span>
                {sameName(value, f.name) && <Check aria-label="Current" />}
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Smaller / size menu / larger, as in the Sheets toolbar. `value` null = mixed or unknown (shown as —). */
export function FontSizePicker({
  value,
  sizes,
  onChange,
  min,
  max,
  disabled,
  restoreFocus = true,
}: Readonly<{
  value: number | null;
  sizes: readonly number[];
  onChange: (size: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  restoreFocus?: boolean;
}>) {
  return (
    <>
      <ToolButton
        label="Smaller text"
        disabled={disabled || value === null || value <= min}
        onClick={() => value !== null && onChange(Math.max(min, value - 1))}
      >
        <Minus />
      </ToolButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-11 px-1 text-xs"
            aria-label="Font size"
            disabled={disabled}
          >
            {value ?? '—'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="max-h-96 min-w-16"
          onCloseAutoFocus={restoreFocus ? undefined : (e) => e.preventDefault()}
        >
          {sizes.map((size) => (
            <DropdownMenuItem key={size} onSelect={() => onChange(size)}>
              {size}
              {value === size && <Check className="ml-auto" aria-label="Current" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolButton
        label="Larger text"
        disabled={disabled || value === null || value >= max}
        onClick={() => value !== null && onChange(Math.min(max, value + 1))}
      >
        <Plus />
      </ToolButton>
    </>
  );
}
