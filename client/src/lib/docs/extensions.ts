import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import type { Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { PageBreak } from './pageBreak';

/** Images a document may hold: inline `data:` images only (no remote images: they would track readers and break .docx export). */
export const isDataImage = (src: unknown): src is string =>
  typeof src === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src);

/** Links a document may hold (pasted `javascript:` or `file:` links are dropped). */
export const isSafeLink = (href: string) => /^(https?:|mailto:)/i.test(href);

/**
 * The Docs editor's schema. Shared by the editor, .docx import (HTML → JSON) and tests, so every document is read
 * with the same nodes and marks.
 */
export function documentExtensions({ placeholder = true } = {}): Extensions {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        isAllowedUri: (url) => isSafeLink(url),
      },
    }),
    TextStyleKit,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ allowBase64: true, inline: false }).extend({
      // Drop images that aren't inline data (e.g. a pasted <img src="https://…">).
      parseHTML: () => [{ tag: 'img[src]', getAttrs: (el) => (isDataImage(el.getAttribute('src')) ? null : false) }],
    }),
    PageBreak,
    CharacterCount,
    ...(placeholder ? [Placeholder.configure({ placeholder: 'Start writing…' })] : []),
  ];
}
