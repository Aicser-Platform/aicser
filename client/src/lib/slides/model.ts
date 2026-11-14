import { officeStore } from '@/lib/office/store';
import { z } from 'zod';

// A Slides presentation: 16:9 slides of positioned elements (text boxes, shapes, pictures) on a 960 × 540 canvas
// (10 × 5.625 in at 96 px/in, PowerPoint's widescreen size), plus a theme and speaker notes.

export const SLIDE_WIDTH = 960;
export const SLIDE_HEIGHT = 540;
/** Text sizes are points; the 960 px canvas is 720 pt wide. */
export const PX_PER_PT = SLIDE_WIDTH / 720;

export const SHAPES = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'rightArrow', 'line'] as const;
export type ShapeKind = (typeof SHAPES)[number];
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  roundRect: 'Rounded rectangle',
  ellipse: 'Oval',
  triangle: 'Triangle',
  diamond: 'Diamond',
  rightArrow: 'Arrow',
  line: 'Line',
};

const color = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .nullable();

export const TextStyleSchema = z.object({
  /** A font name (lib/office/fonts); unset = the theme's heading or body font. */
  fontFamily: z.string().max(64).optional(),
  /** Points. */
  fontSize: z.number().min(4).max(400).default(18),
  /** Unset = the theme's text colour. */
  color: color.optional(),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right']).default('left'),
  valign: z.enum(['top', 'middle', 'bottom']).default('top'),
  bullets: z.boolean().default(false),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const ElementSchema = z.object({
  id: z.string(),
  kind: z.enum(['text', 'shape', 'image']),
  x: z.number(),
  y: z.number(),
  w: z.number().min(1),
  h: z.number().min(0),
  /** Degrees, clockwise. */
  rotation: z.number().default(0),
  /** A layout's title / subtitle / body box: theme fonts and a hint while empty. */
  placeholder: z.enum(['title', 'subtitle', 'body']).optional(),
  shape: z.enum(SHAPES).optional(),
  fill: color.default(null),
  stroke: color.default(null),
  strokeWidth: z.number().min(0).max(50).default(0),
  text: z.string().default(''),
  style: TextStyleSchema.default(TextStyleSchema.parse({})),
  /** Pictures: inline data only (no remote images: they would track viewers and break .pptx export). */
  src: z
    .string()
    .regex(/^data:image\/(png|jpeg|gif|webp);base64,/)
    .optional(),
});
export type SlideElement = z.infer<typeof ElementSchema>;

export const LAYOUTS = ['title', 'title-content', 'section', 'two-content', 'title-only', 'blank'] as const;
export type LayoutKind = (typeof LAYOUTS)[number];
export const LAYOUT_LABELS: Record<LayoutKind, string> = {
  title: 'Title slide',
  'title-content': 'Title and content',
  section: 'Section header',
  'two-content': 'Two content',
  'title-only': 'Title only',
  blank: 'Blank',
};

export const SlideSchema = z.object({
  id: z.string(),
  layout: z.enum(LAYOUTS).default('blank'),
  /** Unset = the theme's background. */
  background: color.default(null),
  elements: z.array(ElementSchema).default([]),
  notes: z.string().default(''),
});
export type Slide = z.infer<typeof SlideSchema>;

export interface Theme {
  id: string;
  name: string;
  background: string;
  title: string;
  text: string;
  accent: string;
  headingFont: string;
  bodyFont: string;
}

/** Document colours (saved in the file and exported to PowerPoint), so fixed hex values. */
export const THEMES: Theme[] = [
  {
    id: 'office',
    name: 'Office',
    background: '#ffffff',
    title: '#1f2937',
    text: '#374151',
    accent: '#1971c2',
    headingFont: 'Calibri',
    bodyFont: 'Calibri',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    background: '#111827',
    title: '#ffffff',
    text: '#d1d5db',
    accent: '#f5c400',
    headingFont: 'Inter',
    bodyFont: 'Inter',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    background: '#0c4a6e',
    title: '#ffffff',
    text: '#e0f2fe',
    accent: '#38bdf8',
    headingFont: 'Roboto',
    bodyFont: 'Roboto',
  },
  {
    id: 'paper',
    name: 'Paper',
    background: '#fdf6e3',
    title: '#7c2d12',
    text: '#44403c',
    accent: '#c2410c',
    headingFont: 'Merriweather',
    bodyFont: 'Georgia',
  },
  {
    id: 'forest',
    name: 'Forest',
    background: '#ecfdf5',
    title: '#065f46',
    text: '#1f2937',
    accent: '#059669',
    headingFont: 'Roboto',
    bodyFont: 'Roboto',
  },
  {
    id: 'angkor',
    name: 'Angkor (Khmer)',
    background: '#3b0764',
    title: '#fbbf24',
    text: '#f5f3ff',
    accent: '#fbbf24',
    headingFont: 'Moul',
    bodyFont: 'Kantumruy Pro',
  },
];

export const themeById = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]!;

export const PresentationBodySchema = z.object({
  themeId: z.string().default('office'),
  slides: z.array(SlideSchema).default([]),
});
export interface PresentationBody extends Record<string, unknown> {
  themeId: string;
  slides: Slide[];
}

export const presentationStore = officeStore<PresentationBody>(
  'presentation',
  (body) => PresentationBodySchema.parse(body),
  'presentation'
);

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const style = (patch: Partial<TextStyle>): TextStyle => TextStyleSchema.parse(patch);

export function textElement(patch: Partial<SlideElement> & Pick<SlideElement, 'x' | 'y' | 'w' | 'h'>): SlideElement {
  return ElementSchema.parse({ id: newId(), kind: 'text', ...patch });
}

/** The placeholder boxes a layout starts with. */
export function layoutElements(layout: LayoutKind): SlideElement[] {
  const title = (x: number, y: number, w: number, h: number, size: number, extra: Partial<TextStyle> = {}) =>
    textElement({ x, y, w, h, placeholder: 'title', style: style({ fontSize: size, bold: true, ...extra }) });
  const body = (x: number, y: number, w: number, h: number) =>
    textElement({ x, y, w, h, placeholder: 'body', style: style({ fontSize: 20, bullets: true }) });
  const subtitle = (x: number, y: number, w: number, h: number, align: TextStyle['align']) =>
    textElement({ x, y, w, h, placeholder: 'subtitle', style: style({ fontSize: 22, align }) });
  switch (layout) {
    case 'title':
      return [
        title(80, 150, 800, 130, 44, { align: 'center', valign: 'bottom' }),
        subtitle(80, 295, 800, 80, 'center'),
      ];
    case 'title-content':
      return [title(60, 30, 840, 80, 34, { valign: 'middle' }), body(60, 130, 840, 370)];
    case 'section':
      return [title(80, 190, 800, 110, 40, { valign: 'bottom' }), subtitle(80, 305, 800, 60, 'left')];
    case 'two-content':
      return [title(60, 30, 840, 80, 34, { valign: 'middle' }), body(60, 130, 410, 370), body(490, 130, 410, 370)];
    case 'title-only':
      return [title(60, 30, 840, 80, 34, { valign: 'middle' })];
    case 'blank':
      return [];
  }
}

export function newSlide(layout: LayoutKind): Slide {
  return { id: newId(), layout, background: null, elements: layoutElements(layout), notes: '' };
}

export const blankPresentation = (): { title: string; body: PresentationBody; meta: Record<string, unknown> } => ({
  title: 'Untitled presentation',
  body: { themeId: 'office', slides: [newSlide('title')] },
  meta: { slides: 1 },
});

export const PLACEHOLDER_HINTS: Record<NonNullable<SlideElement['placeholder']>, string> = {
  title: 'Click to add title',
  subtitle: 'Click to add subtitle',
  body: 'Click to add text',
};

/** Font name for an element: its own, else the theme's heading font for titles and body font otherwise. */
export function elementFont(el: SlideElement, theme: Theme): string {
  return el.style.fontFamily ?? (el.placeholder === 'title' ? theme.headingFont : theme.bodyFont);
}

/** Text colour for an element: its own, else the theme's title or text colour. */
export function elementColor(el: SlideElement, theme: Theme): string {
  return el.style.color ?? (el.placeholder === 'title' ? theme.title : theme.text);
}

/** A copy with fresh ids (duplicate, paste), moved by `offset`. */
export function copyElement(el: SlideElement, offset = 0): SlideElement {
  return { ...el, id: newId(), x: el.x + offset, y: el.y + offset, style: { ...el.style } };
}

export function cloneSlide(slide: Slide): Slide {
  return { ...slide, id: newId(), elements: slide.elements.map((e) => copyElement(e)) };
}

/** Keeps at least a corner of an element on the slide, and a minimum size. */
export function clampBox<T extends Pick<SlideElement, 'x' | 'y' | 'w' | 'h'>>(box: T, minSize = 8): T {
  const w = Math.max(minSize, box.w);
  const h = Math.max(box.h === 0 ? 0 : minSize, box.h);
  return {
    ...box,
    w,
    h,
    x: Math.min(SLIDE_WIDTH - 10, Math.max(10 - w, box.x)),
    y: Math.min(SLIDE_HEIGHT - 10, Math.max(10 - Math.max(h, 1), box.y)),
  };
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** The box after dragging a resize handle by (dx, dy); `keepRatio` scales both sides from the corner. */
export function resizeBox(
  box: Pick<SlideElement, 'x' | 'y' | 'w' | 'h'>,
  handle: Handle,
  dx: number,
  dy: number,
  keepRatio: boolean
): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = box;
  const min = 8;
  if (handle.includes('e')) w = Math.max(min, box.w + dx);
  if (handle.includes('s')) h = Math.max(min, box.h + dy);
  if (handle.includes('w')) {
    w = Math.max(min, box.w - dx);
    x = box.x + box.w - w;
  }
  if (handle.includes('n')) {
    h = Math.max(min, box.h - dy);
    y = box.y + box.h - h;
  }
  if (keepRatio && handle.length === 2 && box.w > 0 && box.h > 0) {
    const ratio = box.w / box.h;
    // Follow the side that moved more.
    if (w / box.w > h / box.h) h = w / ratio;
    else w = h * ratio;
    if (handle.includes('w')) x = box.x + box.w - w;
    if (handle.includes('n')) y = box.y + box.h - h;
  }
  return { x, y, w, h };
}

/** Snap lines: slide edges and centre, and other elements' edges and centres. */
export function snapMove(
  box: { x: number; y: number; w: number; h: number },
  others: { x: number; y: number; w: number; h: number }[],
  tolerance = 6
): { x: number; y: number; guides: { v: number[]; h: number[] } } {
  const vLines = [0, SLIDE_WIDTH / 2, SLIDE_WIDTH, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
  const hLines = [0, SLIDE_HEIGHT / 2, SLIDE_HEIGHT, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
  const snap = (start: number, size: number, lines: number[]) => {
    let best: { delta: number; line: number } | null = null;
    for (const edge of [start, start + size / 2, start + size]) {
      for (const line of lines) {
        const delta = line - edge;
        if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line };
      }
    }
    return best;
  };
  const sx = snap(box.x, box.w, vLines);
  const sy = snap(box.y, box.h, hLines);
  return {
    x: box.x + (sx?.delta ?? 0),
    y: box.y + (sy?.delta ?? 0),
    guides: { v: sx ? [sx.line] : [], h: sy ? [sy.line] : [] },
  };
}

/** Text of a slide's title placeholder (thumbnails, outline). */
export const slideTitle = (slide: Slide) =>
  slide.elements
    .find((e) => e.placeholder === 'title')
    ?.text.split('\n')[0]
    ?.trim() ?? '';
