import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';
import type { JSONContent } from '@tiptap/react';
import { OFFICE_FONTS } from '@/lib/office/fonts';
import { isDataImage, isSafeLink } from './extensions';
import { PAGE_MARGINS, pageDimensions, type PageSetup } from './model';

// Docs document (TipTap JSON) → Word .docx, written in the browser with `docx`. Everything the editor makes maps
// to Word: headings, fonts, sizes, colours, highlight, alignment, lists, checklists, tables, images, links, quotes,
// code and page setup.

const TWIPS_PER_MM = 1440 / 25.4;
const PX_PER_MM = 96 / 25.4;
const ORDERED = 'aicser-ordered';

type Mark = NonNullable<JSONContent['marks']>[number];
type Block = Paragraph | Table;

interface Context {
  /** Usable width for images and tables, in px. */
  contentWidthPx: number;
  /** Ordered lists each restart numbering: one numbering instance per list. */
  nextList: number;
}

/** `#abc`, `#aabbcc` or `rgb(r, g, b)` → `AABBCC` (Word colours); anything else is dropped. */
export function hexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const long = /^#([0-9a-f]{6})$/i.exec(v);
  if (long?.[1]) return long[1].toUpperCase();
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(v);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  return undefined;
}

/** CSS font size (`12pt`, `16px`) → Word half-points. */
export function halfPoints(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+(?:\.\d+)?)(pt|px)$/.exec(value.trim());
  if (!m) return undefined;
  const pt = m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1]);
  return Math.round(pt * 2);
}

/** Word's font name for a CSS font-family: a known font's name (the editor stores its stack), else the first font. */
export function fontName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/"/g, "'");
  const known = OFFICE_FONTS.find((f) => f.stack === normalized);
  if (known) return known.name;
  const first = value
    .split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  return first || undefined;
}

/** Pixel size of a PNG, JPEG or GIF from its header (null when unknown). */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1] ?? 0;
      const length = view.getUint16(i + 2);
      // SOF0–SOF15 (except DHT/JPG/DAC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
      }
      i += 2 + length;
    }
  }
  return null;
}

function dataUrlBytes(src: string): { type: 'png' | 'jpg' | 'gif' | 'webp'; bytes: Uint8Array } {
  const [head = '', data = ''] = src.split(',', 2);
  const mime = /^data:image\/(png|jpeg|gif|webp)/.exec(head)?.[1] ?? 'png';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { type: mime === 'jpeg' ? 'jpg' : (mime as 'png' | 'gif' | 'webp'), bytes };
}

/** Word has no WebP: draw it to a PNG (browser only; null when that isn't possible). */
async function webpToPng(src: string): Promise<string | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function runOptions(text: string, marks: Mark[] = []): IRunOptions {
  const opts: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = { text };
  for (const mark of marks) {
    const a = (mark.attrs ?? {}) as Record<string, unknown>;
    switch (mark.type) {
      case 'bold':
        opts.bold = true;
        break;
      case 'italic':
        opts.italics = true;
        break;
      case 'underline':
        opts.underline = {};
        break;
      case 'strike':
        opts.strike = true;
        break;
      case 'subscript':
        opts.subScript = true;
        break;
      case 'superscript':
        opts.superScript = true;
        break;
      case 'code':
        opts.font = 'Courier New';
        break;
      case 'highlight': {
        const fill = hexColor(a.color) ?? 'FFF3BF';
        opts.shading = { type: ShadingType.CLEAR, fill, color: 'auto' };
        break;
      }
      case 'link':
        opts.style = 'Hyperlink';
        break;
      case 'textStyle': {
        const color = hexColor(a.color);
        if (color) opts.color = color;
        const size = halfPoints(a.fontSize);
        if (size) opts.size = size;
        const font = fontName(a.fontFamily);
        if (font) opts.font = font;
        const fill = hexColor(a.backgroundColor);
        if (fill) opts.shading = { type: ShadingType.CLEAR, fill, color: 'auto' };
        break;
      }
    }
  }
  return opts;
}

/** Inline content of a paragraph or heading. */
async function inline(nodes: JSONContent[] = [], ctx: Context, base: Mark[] = []): Promise<ParagraphChild[]> {
  const out: ParagraphChild[] = [];
  for (const node of nodes) {
    if (node.type === 'text' && node.text) {
      const marks = [...base, ...(node.marks ?? [])];
      const link = marks.find((m) => m.type === 'link');
      const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : '';
      const run = new TextRun(runOptions(node.text, marks));
      out.push(href && isSafeLink(href) ? new ExternalHyperlink({ link: href, children: [run] }) : run);
    } else if (node.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }));
    } else if (node.type === 'image') {
      const image = await imageRun(node, ctx);
      if (image) out.push(image);
    }
  }
  return out;
}

async function imageRun(node: JSONContent, ctx: Context): Promise<ImageRun | null> {
  let src = node.attrs?.src as unknown;
  if (!isDataImage(src)) return null;
  if (src.startsWith('data:image/webp')) {
    const png = await webpToPng(src);
    if (!png) return null;
    src = png;
  }
  const { type, bytes } = dataUrlBytes(src as string);
  if (type === 'webp') return null;
  const natural = imageSize(bytes) ?? { width: 400, height: 300 };
  let width = Number(node.attrs?.width) || natural.width;
  let height = Number(node.attrs?.height) || (natural.height * width) / natural.width;
  if (width > ctx.contentWidthPx) {
    height = (height * ctx.contentWidthPx) / width;
    width = ctx.contentWidthPx;
  }
  return new ImageRun({
    type,
    data: bytes,
    transformation: { width: Math.round(width), height: Math.round(height) },
    altText: { name: String(node.attrs?.alt ?? 'Image'), description: String(node.attrs?.alt ?? ''), title: '' },
  });
}

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

type ParagraphExtras = { -readonly [K in keyof IParagraphOptions]?: IParagraphOptions[K] };

async function paragraph(node: JSONContent, ctx: Context, extras: ParagraphExtras = {}): Promise<Paragraph> {
  const align = ALIGN[String(node.attrs?.textAlign ?? '')];
  const options: ParagraphExtras = { ...extras, children: await inline(node.content, ctx) };
  if (align) options.alignment = align;
  if (node.type === 'heading') {
    const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
    options.heading = HEADINGS[level - 1];
  }
  return new Paragraph(options as IParagraphOptions);
}

interface ListState {
  kind: 'bullet' | 'ordered' | 'task';
  level: number;
  instance: number;
}

async function blocks(nodes: JSONContent[] = [], ctx: Context, list?: ListState, quote = false): Promise<Block[]> {
  const out: Block[] = [];
  const quoteExtras: ParagraphExtras = quote
    ? {
        indent: { left: 567 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } },
      }
    : {};
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
        out.push(await paragraph(node, ctx, quoteExtras));
        break;
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        const kind = node.type === 'bulletList' ? 'bullet' : node.type === 'orderedList' ? 'ordered' : 'task';
        const level = list ? Math.min(8, list.level + 1) : 0;
        const instance = kind === 'ordered' ? ctx.nextList++ : 0;
        for (const item of node.content ?? []) {
          out.push(...(await listItem(item, ctx, { kind, level, instance })));
        }
        break;
      }
      case 'blockquote':
        out.push(...(await blocks(node.content, ctx, list, true)));
        break;
      case 'codeBlock': {
        const text = (node.content ?? []).map((t) => t.text ?? '').join('');
        for (const line of text.split('\n')) {
          out.push(
            new Paragraph({
              children: [new TextRun({ text: line, font: 'Courier New', size: 20 })],
              shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' },
              spacing: { after: 0 },
            })
          );
        }
        break;
      }
      case 'horizontalRule':
        out.push(
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } },
          })
        );
        break;
      case 'pageBreak':
        out.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case 'image': {
        const image = await imageRun(node, ctx);
        if (image) out.push(new Paragraph({ children: [image] }));
        break;
      }
      case 'table':
        out.push(await table(node, ctx));
        // Word needs a paragraph between two tables (and after a table at the end of a cell).
        out.push(new Paragraph({ children: [] }));
        break;
    }
  }
  return out;
}

async function listItem(item: JSONContent, ctx: Context, state: ListState): Promise<Block[]> {
  const out: Block[] = [];
  let first = true;
  for (const child of item.content ?? []) {
    if (child.type === 'paragraph' && first) {
      first = false;
      if (state.kind === 'bullet') {
        out.push(await paragraph(child, ctx, { bullet: { level: state.level } }));
      } else if (state.kind === 'ordered') {
        out.push(
          await paragraph(child, ctx, {
            numbering: { reference: ORDERED, level: state.level, instance: state.instance },
          })
        );
      } else {
        const box = item.attrs?.checked ? '☑ ' : '☐ ';
        const p = await paragraph({ ...child, content: [{ type: 'text', text: box }, ...(child.content ?? [])] }, ctx, {
          indent: { left: 360 * (state.level + 1) },
        });
        out.push(p);
      }
    } else {
      out.push(...(await blocks([child], ctx, state)));
    }
  }
  return out;
}

async function table(node: JSONContent, ctx: Context): Promise<Table> {
  const rows: TableRow[] = [];
  for (const row of node.content ?? []) {
    const cells: TableCell[] = [];
    for (const cell of row.content ?? []) {
      const header = cell.type === 'tableHeader';
      const content = await blocks(cell.content, { ...ctx, contentWidthPx: ctx.contentWidthPx / 2 });
      const colwidth = Array.isArray(cell.attrs?.colwidth) ? (cell.attrs.colwidth as unknown[]) : [];
      const widthPx = colwidth.reduce<number>((sum, w) => sum + (Number(w) || 0), 0);
      cells.push(
        new TableCell({
          children: content.length ? content : [new Paragraph({ children: [] })],
          columnSpan: Number(cell.attrs?.colspan) || 1,
          rowSpan: Number(cell.attrs?.rowspan) || 1,
          ...(widthPx ? { width: { size: Math.round(widthPx * 15), type: WidthType.DXA } } : {}),
          ...(header ? { shading: { type: ShadingType.CLEAR, fill: 'F1F3F5', color: 'auto' } } : {}),
        })
      );
    }
    rows.push(new TableRow({ children: cells, tableHeader: row.content?.[0]?.type === 'tableHeader' }));
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

const ORDERED_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];

/** A document as .docx bytes. */
export async function documentToDocx(title: string, content: JSONContent, page: PageSetup): Promise<Uint8Array> {
  const { widthMm, heightMm } = pageDimensions(page);
  const marginMm = PAGE_MARGINS[page.margins].mm;
  const ctx: Context = { contentWidthPx: (widthMm - 2 * marginMm) * PX_PER_MM, nextList: 1 };
  const children = await blocks(content.content, ctx);
  const margin = Math.round(marginMm * TWIPS_PER_MM);
  const doc = new Document({
    title,
    creator: 'Aicser',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        {
          reference: ORDERED,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: ORDERED_FORMATS[level % 3] ?? LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            // docx swaps width and height itself for landscape: always pass the portrait size.
            size: {
              width: Math.round(Math.min(widthMm, heightMm) * TWIPS_PER_MM),
              height: Math.round(Math.max(widthMm, heightMm) * TWIPS_PER_MM),
              orientation: page.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: { top: margin, right: margin, bottom: margin, left: margin },
          },
        },
        children: children.length ? children : [new Paragraph({ children: [] })],
      },
    ],
  });
  return Packer.pack(doc, 'uint8array');
}
