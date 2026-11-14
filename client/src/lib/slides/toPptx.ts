import PptxGenJS from 'pptxgenjs';
import {
  SLIDE_WIDTH,
  elementColor,
  elementFont,
  themeById,
  type PresentationBody,
  type SlideElement,
  type Theme,
} from './model';

// Slides presentation → PowerPoint .pptx (pptxgenjs, in the browser). The canvas is PowerPoint's 16:9 size
// (10 × 5.625 in), so positions map 1:1: 96 px per inch. Empty placeholders (their hints) are not exported.

const PX_PER_IN = SLIDE_WIDTH / 10;
const inches = (px: number) => Math.round((px / PX_PER_IN) * 1000) / 1000;
const hex = (color: string) => color.replace('#', '').toUpperCase();

type Slide = ReturnType<PptxGenJS['addSlide']>;

function textProps(el: SlideElement, theme: Theme) {
  return {
    fontFace: elementFont(el, theme),
    fontSize: el.style.fontSize,
    color: hex(elementColor(el, theme)),
    bold: el.style.bold,
    italic: el.style.italic,
    ...(el.style.underline ? { underline: { style: 'sng' as const } } : {}),
    align: el.style.align,
    valign: el.style.valign,
  };
}

function textRuns(el: SlideElement): PptxGenJS.TextProps[] {
  const lines = el.text.split('\n');
  return lines.map((line, i) => ({
    text: line,
    options: { ...(el.style.bullets ? { bullet: true } : {}), ...(i < lines.length - 1 ? { breakLine: true } : {}) },
  }));
}

function addElement(pres: PptxGenJS, slide: Slide, el: SlideElement, theme: Theme) {
  const box = {
    x: inches(el.x),
    y: inches(el.y),
    w: inches(el.w),
    h: inches(el.h),
    ...(el.rotation ? { rotate: el.rotation } : {}),
  };
  const fill = el.fill ? { fill: { color: hex(el.fill) } } : {};
  const line = el.stroke ? { line: { color: hex(el.stroke), width: Math.max(el.strokeWidth, 1) * 0.75 } } : {};
  if (el.kind === 'image') {
    if (el.src) slide.addImage({ data: el.src.replace(/^data:/, ''), ...box });
    return;
  }
  if (el.kind === 'shape' && el.shape === 'line') {
    slide.addShape(pres.ShapeType.line, {
      ...box,
      line: { color: hex(el.stroke ?? '#000000'), width: Math.max(el.strokeWidth, 1) * 0.75 },
    });
    return;
  }
  if (el.kind === 'shape') {
    const shape = pres.ShapeType[el.shape ?? 'rect'];
    slide.addText(el.text ? textRuns(el) : '', { ...box, shape, ...fill, ...line, ...textProps(el, theme) });
    return;
  }
  if (!el.text && !el.fill && !el.stroke) return;
  slide.addText(textRuns(el), { ...box, ...fill, ...line, ...textProps(el, theme) });
}

export async function presentationToPptx(title: string, body: PresentationBody): Promise<Uint8Array> {
  const theme = themeById(body.themeId);
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  pres.title = title;
  pres.company = 'Aicser';
  pres.theme = { headFontFace: theme.headingFont, bodyFontFace: theme.bodyFont };
  for (const s of body.slides) {
    const slide = pres.addSlide();
    slide.background = { color: hex(s.background ?? theme.background) };
    for (const el of s.elements) addElement(pres, slide, el, theme);
    if (s.notes.trim()) slide.addNotes(s.notes);
  }
  const out = await pres.write({ outputType: 'uint8array' });
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  throw new Error('The presentation could not be written.');
}
