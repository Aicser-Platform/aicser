import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { slideFooter } from './footer';
import { newSlide, PresentationBodySchema, SlideFooterSchema, type PresentationBody } from './model';
import { presentationToPptx } from './toPptx';

const NOW = new Date(2026, 10, 14);
const footer = (patch: Partial<ReturnType<typeof SlideFooterSchema.parse>>) => SlideFooterSchema.parse(patch);

describe('slide footer', () => {
  it('shows nothing for older presentations or an empty footer', () => {
    expect(slideFooter(undefined, newSlide('blank'), 0, NOW)).toBeNull();
    expect(slideFooter(footer({ text: '  ' }), newSlide('blank'), 0, NOW)).toBeNull();
    expect(PresentationBodySchema.parse({ slides: [] }).footer).toBeUndefined();
  });

  it('numbers slides and skips title slides unless asked', () => {
    const f = footer({ text: 'Aicser', slideNumbers: true });
    expect(slideFooter(f, newSlide('title'), 0, NOW)).toBeNull();
    expect(slideFooter(f, newSlide('title-content'), 2, NOW)).toEqual({ date: null, text: 'Aicser', number: '3' });
    expect(slideFooter({ ...f, skipTitle: false }, newSlide('title'), 0, NOW)?.number).toBe('1');
  });

  it('shows the date when asked', () => {
    const content = slideFooter(footer({ date: true }), newSlide('blank'), 0, NOW);
    expect(content?.date).toContain('2026');
  });

  it('writes the footer and a slide number field to the .pptx', async () => {
    const body: PresentationBody = {
      themeId: 'office',
      slides: [newSlide('title'), newSlide('title-content')],
      footer: footer({ text: 'Confidential', slideNumbers: true }),
    };
    const zip = await JSZip.loadAsync(await presentationToPptx('Deck', body));
    const first = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const second = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(first).not.toContain('Confidential');
    expect(second).toContain('Confidential');
    expect(second).toContain('type="slidenum"');
  });
});
