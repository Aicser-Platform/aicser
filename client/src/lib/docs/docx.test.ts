import type { JSONContent } from '@tiptap/react';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { docxToDocument } from './fromDocx';
import { countWords, documentText, pageDimensions } from './model';
import { documentToDocx, fontName, halfPoints, hexColor, imageSize } from './toDocx';

// A 2 × 3 px PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGP4z8DwnwEIGBgYAB3gAv6jOFTnAAAAAElFTkSuQmCC';

const text = (t: string, marks?: JSONContent['marks']): JSONContent => ({
  type: 'text',
  text: t,
  ...(marks ? { marks } : {}),
});
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });

const SAMPLE: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Quarterly report')] },
    p(text('Revenue grew '), text('12%', [{ type: 'bold' }]), text(' in '), text('Phnom Penh', [{ type: 'italic' }])),
    p(
      text('ការលក់ បានកើនឡើង', [
        {
          type: 'textStyle',
          attrs: {
            fontFamily: "'Kantumruy Pro Variable', 'Kantumruy Pro', 'Noto Sans Khmer Variable', sans-serif",
            color: '#e03131',
            fontSize: '14pt',
          },
        },
      ])
    ),
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(text('First point'))] },
        { type: 'listItem', content: [p(text('Second point'))] },
      ],
    },
    { type: 'orderedList', content: [{ type: 'listItem', content: [p(text('Step one'))] }] },
    p(text('Read the '), text('guide', [{ type: 'link', attrs: { href: 'https://aicser.com/guide' } }])),
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [p(text('City'))] },
            { type: 'tableHeader', content: [p(text('Sales'))] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [p(text('Siem Reap'))] },
            { type: 'tableCell', content: [p(text('42'))] },
          ],
        },
      ],
    },
    { type: 'image', attrs: { src: PNG, alt: 'dot' } },
    { type: 'horizontalRule' },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(text('Done'))] }] },
  ],
};

describe('docx helpers', () => {
  it('normalizes colours, sizes and fonts for Word', () => {
    expect(hexColor('#abc')).toBe('AABBCC');
    expect(hexColor('#E03131')).toBe('E03131');
    expect(hexColor('rgb(255, 0, 16)')).toBe('FF0010');
    expect(hexColor('red')).toBeUndefined();
    expect(halfPoints('12pt')).toBe(24);
    expect(halfPoints('16px')).toBe(24);
    expect(halfPoints('large')).toBeUndefined();
    expect(fontName("'Inter Variable', 'Inter', 'Noto Sans Khmer Variable', sans-serif")).toBe('Inter');
    expect(fontName('"Moul", serif')).toBe('Moul');
  });

  it('reads image sizes from their headers', () => {
    const bytes = Uint8Array.from(atob(PNG.split(',')[1]!), (c) => c.charCodeAt(0));
    expect(imageSize(bytes)).toEqual({ width: 2, height: 3 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('counts words and page sizes', () => {
    expect(countWords('Hello  world, ok')).toBe(3);
    expect(countWords(' — ')).toBe(0);
    expect(documentText(SAMPLE)).toContain('Quarterly report\nRevenue grew 12% in Phnom Penh');
    expect(pageDimensions({ size: 'a4', margins: 'normal', orientation: 'landscape' })).toEqual({
      widthMm: 297,
      heightMm: 210,
    });
  });
});

describe('Word round trip', () => {
  it('writes a valid .docx with styles, lists, tables, links, images and page setup', async () => {
    const bytes = await documentToDocx('Report', SAMPLE, {
      size: 'letter',
      margins: 'narrow',
      orientation: 'portrait',
    });
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Quarterly report');
    expect(xml).toContain('w:pStyle w:val="Heading1"');
    expect(xml).toContain('w:rFonts w:ascii="Kantumruy Pro"');
    expect(xml).toContain('w:color w:val="E03131"');
    expect(xml).toContain('w:sz w:val="28"');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('☑ ');
    expect(xml).toMatch(/w:pgSz w:w="12240" w:h="15840"/);
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    expect(rels).toContain('https://aicser.com/guide');
  });

  it('opens what it wrote', async () => {
    const bytes = await documentToDocx('Report', SAMPLE, { size: 'a4', margins: 'normal', orientation: 'portrait' });
    const { content } = await docxToDocument(bytes);
    const nodes = content.content ?? [];
    expect(nodes[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(documentText(content)).toContain('Revenue grew 12% in Phnom Penh');
    expect(JSON.stringify(nodes[1])).toContain('"bold"');
    expect(nodes.some((n) => n.type === 'bulletList')).toBe(true);
    expect(nodes.some((n) => n.type === 'orderedList')).toBe(true);
    expect(nodes.some((n) => n.type === 'table')).toBe(true);
    expect(JSON.stringify(content)).toContain('https://aicser.com/guide');
    expect(JSON.stringify(content)).toMatch(/"src":"data:image\/png;base64,/);
  });

  it('keeps page breaks both ways', async () => {
    const doc: JSONContent = { type: 'doc', content: [p(text('One')), { type: 'pageBreak' }, p(text('Two'))] };
    const bytes = await documentToDocx('Breaks', doc, { size: 'a4', orientation: 'portrait', margins: 'normal' });
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    expect(xml).toContain('w:type="page"');
    const back = await docxToDocument(bytes);
    expect(back.content.content?.map((n) => n.type)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
  });

  it('refuses a file that is not a Word document', async () => {
    await expect(docxToDocument(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
