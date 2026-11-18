'use client';

import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/aicser-ui/button';
import { Checkbox } from '@/components/aicser-ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import { Input } from '@/components/aicser-ui/input';
import { Label } from '@/components/aicser-ui/label';
import { Segmented } from '@/components/aicser-ui/segmented';
import type { PageSetup } from '@/lib/docs/model';
import type { SlotAlign } from '@/lib/docs/pageElements';

export type PageElementField = 'header' | 'footer';

const ALIGN_OPTIONS = [
  { value: 'left' as const, label: <AlignLeft className="size-4" aria-label="Left" /> },
  { value: 'center' as const, label: <AlignCenter className="size-4" aria-label="Center" /> },
  { value: 'right' as const, label: <AlignRight className="size-4" aria-label="Right" /> },
];

/**
 * Header, footer and page numbers (Google Docs' "Page elements"). Changes apply as they are made, like the rest of
 * the editor (and autosave); Done only closes.
 */
export function PageElementsDialog({
  open,
  focus,
  page,
  onOpenChange,
  onChange,
}: Readonly<{
  open: boolean;
  focus: PageElementField;
  page: PageSetup;
  onOpenChange: (open: boolean) => void;
  onChange: (page: PageSetup) => void;
}>) {
  const id = useId();
  const numbers = page.pageNumbers ?? 'none';
  const set = (patch: Partial<PageSetup>) => onChange({ ...page, ...patch });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Page elements</DialogTitle>
          <DialogDescription>Shown at the top and bottom of every page, and in the .docx export.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-header`}>Header</Label>
            <div className="flex gap-2">
              <Input
                id={`${id}-header`}
                autoFocus={focus === 'header'}
                placeholder="e.g. Company name"
                maxLength={300}
                value={page.header ?? ''}
                onChange={(e) => set({ header: e.target.value })}
              />
              <Segmented
                label="Header alignment"
                size="sm"
                value={page.headerAlign ?? 'left'}
                options={ALIGN_OPTIONS}
                onChange={(v: SlotAlign) => set({ headerAlign: v })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${id}-footer`}>Footer</Label>
            <div className="flex gap-2">
              <Input
                id={`${id}-footer`}
                autoFocus={focus === 'footer'}
                placeholder="e.g. Confidential"
                maxLength={300}
                value={page.footer ?? ''}
                onChange={(e) => set({ footer: e.target.value })}
              />
              <Segmented
                label="Footer alignment"
                size="sm"
                value={page.footerAlign ?? 'left'}
                options={ALIGN_OPTIONS}
                onChange={(v: SlotAlign) => set({ footerAlign: v })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-medium">Page numbers</span>
            <Segmented
              label="Page numbers"
              value={numbers}
              options={[
                { value: 'none', label: 'None' },
                { value: 'header', label: 'In header' },
                { value: 'footer', label: 'In footer' },
              ]}
              onChange={(v) => set({ pageNumbers: v })}
            />
            {numbers !== 'none' && (
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  label="Page number alignment"
                  size="sm"
                  value={page.pageNumberAlign ?? 'right'}
                  options={ALIGN_OPTIONS}
                  onChange={(v: SlotAlign) => set({ pageNumberAlign: v })}
                />
                <Segmented
                  label="Page number format"
                  size="sm"
                  value={page.pageNumberStyle ?? 'number'}
                  options={[
                    { value: 'number', label: '1' },
                    { value: 'pageOf', label: 'Page 1 of N' },
                  ]}
                  onChange={(v) => set({ pageNumberStyle: v })}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-first`}
              checked={page.differentFirstPage ?? false}
              onCheckedChange={(checked) => set({ differentFirstPage: checked === true })}
            />
            <Label htmlFor={`${id}-first`} className="font-normal">
              Different first page (no header, footer or number on page 1)
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
