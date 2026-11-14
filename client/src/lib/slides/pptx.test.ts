import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { pptxToPresentation } from './fromPptx';
import { ElementSchema, newSlide, type PresentationBody } from './model';
import { presentationToPptx } from './toPptx';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGP4z8DwnwEIGBgYAB3gAv6jOFTnAAAAAElFTkSuQmCC';

function sample(): PresentationBody {
  const first = newSlide('title');
  first.elements[0]!.text = 'Quarterly review';
  first.elements[1]!.text = 'ការប្រជុំ ត្រីមាស';
  first.elements[1]!.style.fontFamily = 'Kantumruy Pro';
  first.notes = 'Welcome everyone';
  const second = newSlide('title-content');
  second.background = '#fdf6e3';
  second.elements[0]!.text = 'Highlights';
  second.elements[1]!.text = 'Revenue up 12%\nTwo new cities';
  second.elements.push(
    ElementSchema.parse({
      id: 'shape',
      kind: 'shape',
      shape: 'ellipse',
      x: 600,
      y: 300,
      w: 200,
      h: 120,
      fill: '#1971c2',
      text: 'Go',
      style: { fontSize: 24, bold: true, color: '#ffffff', align: 'center', valign: 'middle' },
    }),
    ElementSchema.parse({ id: 'pic', kind: 'image', x: 96, y: 96, w: 192, h: 288, src: PNG }),
    ElementSchema.parse({
      id: 'line',
      kind: 'shape',
      shape: 'line',
      x: 60,
      y: 120,
      w: 840,
      h: 0,
      stroke: '#e03131',
      strokeWidth: 2,
    })
  );
  return { themeId: 'midnight', slides: [first, second] };
}

describe('PowerPoint round trip', () => {
  it('writes slides, notes, pictures and backgrounds to .pptx', async () => {
    const bytes = await presentationToPptx('Review', sample());
    const zip = await JSZip.loadAsync(bytes);
    const slide1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(slide1).toContain('Quarterly review');
    expect(slide1).toContain('ការប្រជុំ ត្រីមាស');
    expect(slide1).toContain('typeface="Kantumruy Pro"');
    expect(slide1).toContain('111827'); // Midnight background
    const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(slide2).toContain('prst="ellipse"');
    expect(slide2).toContain('FDF6E3');
    expect(Object.keys(zip.files).some((f) => f.startsWith('ppt/media/'))).toBe(true);
    expect(Object.keys(zip.files).some((f) => f.startsWith('ppt/notesSlides/'))).toBe(true);
  });

  it('opens what it wrote', async () => {
    const { body, skipped } = await pptxToPresentation(await presentationToPptx('Review', sample()));
    expect(skipped).toBe(0);
    expect(body.slides).toHaveLength(2);
    const [one, two] = body.slides;
    expect(one!.elements.map((e) => e.text)).toEqual(['Quarterly review', 'ការប្រជុំ ត្រីមាស']);
    expect(one!.elements[1]!.style.fontFamily).toBe('Kantumruy Pro');
    expect(one!.notes).toBe('Welcome everyone');
    expect(one!.background).toBe('#111827');
    expect(two!.background).toBe('#fdf6e3');
    const title = one!.elements[0]!;
    expect(title.x).toBeCloseTo(80, 0);
    expect(title.w).toBeCloseTo(800, 0);
    expect(title.style).toMatchObject({ fontSize: 44, bold: true, align: 'center', valign: 'bottom' });
    const bodyBox = two!.elements[1]!;
    expect(bodyBox.text).toBe('Revenue up 12%\nTwo new cities');
    expect(bodyBox.style.bullets).toBe(true);
    const shape = two!.elements.find((e) => e.kind === 'shape' && e.shape === 'ellipse');
    expect(shape).toMatchObject({ fill: '#1971c2', text: 'Go' });
    expect(shape!.style).toMatchObject({ bold: true, color: '#ffffff', align: 'center', valign: 'middle' });
    const pic = two!.elements.find((e) => e.kind === 'image');
    expect(pic!.src).toMatch(/^data:image\/png;base64,/);
    expect(pic!.h).toBeCloseTo(288, 0);
    const line = two!.elements.find((e) => e.shape === 'line');
    expect(line).toMatchObject({ stroke: '#e03131' });
  });

  it('refuses files that are not presentations', async () => {
    await expect(pptxToPresentation(new Uint8Array([1, 2, 3]))).rejects.toThrow("isn't a PowerPoint");
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    await expect(pptxToPresentation(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      "isn't a PowerPoint"
    );
  });
});
