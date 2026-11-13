import type { JSONContent } from '@tiptap/react';
import { officeStore } from '@/lib/office/store';
import { z } from 'zod';

export const PAGE_SIZES = {
  a4: { label: 'A4', widthMm: 210, heightMm: 297 },
  letter: { label: 'Letter', widthMm: 215.9, heightMm: 279.4 },
} as const;
export type PageSize = keyof typeof PAGE_SIZES;

export const PAGE_MARGINS = {
  normal: { label: 'Normal (2.54 cm)', mm: 25.4 },
  narrow: { label: 'Narrow (1.27 cm)', mm: 12.7 },
  wide: { label: 'Wide (5.08 cm)', mm: 50.8 },
} as const;
export type PageMargins = keyof typeof PAGE_MARGINS;

export const PageSetupSchema = z.object({
  size: z.enum(['a4', 'letter']).default('a4'),
  margins: z.enum(['normal', 'narrow', 'wide']).default('normal'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
});
export type PageSetup = z.infer<typeof PageSetupSchema>;

/** A Docs document: the editor's (TipTap / ProseMirror) JSON plus page setup. */
export const DocumentBodySchema = z.object({
  content: z.record(z.string(), z.unknown()),
  page: PageSetupSchema.default({ size: 'a4', margins: 'normal', orientation: 'portrait' }),
});
export interface DocumentBody extends Record<string, unknown> {
  content: JSONContent;
  page: PageSetup;
}

export const EMPTY_CONTENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export const blankDocument = (): { title: string; body: DocumentBody } => ({
  title: 'Untitled document',
  body: { content: EMPTY_CONTENT, page: { size: 'a4', margins: 'normal', orientation: 'portrait' } },
});

/** Page width and height in mm for the setup's orientation. */
export function pageDimensions(page: PageSetup): { widthMm: number; heightMm: number } {
  const { widthMm, heightMm } = PAGE_SIZES[page.size];
  return page.orientation === 'landscape' ? { widthMm: heightMm, heightMm: widthMm } : { widthMm, heightMm };
}

/** Words in plain text (Khmer has no spaces between words, so a run of Khmer counts as one). */
export function countWords(text: string): number {
  return text.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The document's plain text (blocks on their own lines), e.g. to count words without an editor. */
export function documentText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  const inner = (node.content ?? []).map(documentText);
  return node.type === 'paragraph' || node.type === 'heading' ? inner.join('') : inner.join('\n');
}

export const documentStore = officeStore<DocumentBody>(
  'document',
  (body) => DocumentBodySchema.parse(body),
  'document'
);
