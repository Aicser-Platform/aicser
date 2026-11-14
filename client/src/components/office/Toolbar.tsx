'use client';

import { Ban } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/aicser-ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/aicser-ui/popover';
import { Separator } from '@/components/aicser-ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/aicser-ui/tooltip';
import { DOCUMENT_COLORS } from '@/lib/office/palette';

// Toolbar pieces shared by the Docs and Slides editors (same look as the Sheets toolbar).

export function ToolButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: Readonly<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** A toggle (bold, a list…): shown pressed when the selection has it. */
  pressed?: boolean;
  children: ReactNode;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={pressed ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          // Keep the editor's selection: a toolbar click must not take focus away first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const ToolSeparator = () => <Separator orientation="vertical" className="mx-1 !h-5" />;

/**
 * A colour button: the icon with a bar of the current colour, and a grid of document colours (fixed hex values:
 * they are saved in the file and look the same in Word / PowerPoint). `none` clears it when allowed.
 */
export function ColorPicker({
  label,
  icon,
  value,
  onPick,
  allowNone = true,
  disabled,
}: Readonly<{
  label: string;
  icon: ReactNode;
  value: string | null | undefined;
  onPick: (color: string | null) => void;
  allowNone?: boolean;
  disabled?: boolean;
}>) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              className="relative"
            >
              {icon}
              <span
                aria-hidden="true"
                className="absolute inset-x-1.5 bottom-1 h-0.5 rounded-full border border-border"
                style={{ background: value ?? 'transparent' }}
              />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-auto p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="grid grid-cols-8 gap-1" role="group" aria-label={label}>
          {DOCUMENT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={value?.toLowerCase() === color}
              className="size-6 rounded border border-border outline-offset-1 aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-ring"
              style={{ background: color }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(color)}
            />
          ))}
        </div>
        {allowNone && (
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => onPick(null)}>
            <Ban /> None
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
