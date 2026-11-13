import { generateJSON, type JSONContent } from '@tiptap/react';
import mammoth from 'mammoth';
import { documentExtensions } from './extensions';

// Word .docx → Docs document. mammoth reads the file's structure (headings, bold/italic/underline, lists, tables,
// links, images as inline data); the editor schema then parses that HTML in a detached document (never inserted
// into the page), dropping anything it has no node for (scripts, remote images, styles). Fonts, colours and page
// setup are not carried over by mammoth.

export interface ImportedDocument {
  content: JSONContent;
  /** mammoth's notes about content it skipped (shown to the user as a count). */
  warnings: number;
}

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  'u => u',
  'strike => s',
  // Word page breaks → the editor's page break node (lib/docs/pageBreak.ts).
  "br[type='page'] => hr.page-break",
];

export async function docxToDocument(bytes: Uint8Array): Promise<ImportedDocument> {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  // The app bundles mammoth's browser build (reads `arrayBuffer`); its Node build (unit tests) reads `buffer`.
  const input = { arrayBuffer, buffer: bytes } as unknown as Parameters<typeof mammoth.convertToHtml>[0];
  const result = await mammoth.convertToHtml(input, { styleMap: STYLE_MAP });
  // A paragraph holding only a page break (how Word and toDocx write one) is just the break, not two empty paragraphs.
  const html = result.value.replace(/<p>\s*(<hr class="page-break"\s*\/?>)\s*<\/p>/g, '$1');
  const content = generateJSON(html || '<p></p>', documentExtensions({ placeholder: false })) as JSONContent;
  return { content, warnings: result.messages.filter((m) => m.type === 'warning').length };
}
