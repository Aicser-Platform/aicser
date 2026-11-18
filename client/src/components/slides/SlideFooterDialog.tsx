'use client';

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
import { SlideFooterSchema, type SlideFooter } from '@/lib/slides/model';

/**
 * PowerPoint's "Header & Footer" for slides: date, footer text and slide number on every slide. Changes apply as
 * they are made (one undo step while typing); Done only closes.
 */
export function SlideFooterDialog({
  open,
  footer,
  readOnly,
  onOpenChange,
  onChange,
}: Readonly<{
  open: boolean;
  footer: SlideFooter | undefined;
  readOnly: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (footer: SlideFooter, merge?: string) => void;
}>) {
  const id = useId();
  const value = footer ?? SlideFooterSchema.parse({});
  const set = (patch: Partial<SlideFooter>, merge?: string) => onChange({ ...value, ...patch }, merge);
  const check = (key: 'date' | 'slideNumbers' | 'skipTitle', label: string) => (
    <div className="flex items-center gap-2">
      <Checkbox
        id={`${id}-${key}`}
        disabled={readOnly}
        checked={value[key]}
        onCheckedChange={(checked) => set({ [key]: checked === true })}
      />
      <Label htmlFor={`${id}-${key}`} className="font-normal">
        {label}
      </Label>
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Header &amp; footer</DialogTitle>
          <DialogDescription>
            Shown along the bottom of every slide, when presenting and in the .pptx.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {check('date', 'Date (today’s, updated each time)')}
          {check('slideNumbers', 'Slide number')}
          <div className="grid gap-2">
            <Label htmlFor={`${id}-text`}>Footer</Label>
            <Input
              id={`${id}-text`}
              autoFocus
              disabled={readOnly}
              placeholder="e.g. Company name · Confidential"
              maxLength={200}
              value={value.text}
              onChange={(e) => set({ text: e.target.value }, 'slide-footer-text')}
            />
          </div>
          {check('skipTitle', 'Don’t show on title slides')}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
