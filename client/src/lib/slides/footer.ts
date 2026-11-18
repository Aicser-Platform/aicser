import type { Slide, SlideFooter } from './model';

// What a slide's footer row shows: the date on the left, the footer text in the middle and the slide number on the
// right, in PowerPoint's own widescreen placeholder boxes (so the .pptx matches the canvas).

export interface FooterContent {
  date: string | null;
  text: string | null;
  number: string | null;
}

/** The boxes, in canvas px (960 × 540): PowerPoint's date, footer and slide number placeholders. */
export const FOOTER_BOXES = {
  date: { x: 48, y: 500, w: 216, h: 28, align: 'left' },
  text: { x: 317, y: 500, w: 326, h: 28, align: 'center' },
  number: { x: 696, y: 500, w: 216, h: 28, align: 'right' },
} as const;

/** Footer text size in points. */
export const FOOTER_FONT_PT = 12;

/** Today as the footer shows it, e.g. "14 Nov 2026". */
export const footerDate = (now: Date) =>
  now.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** The footer row of the slide at `index` (0-based), or null when it shows nothing. */
export function slideFooter(
  footer: SlideFooter | undefined,
  slide: Slide,
  index: number,
  now: Date = new Date()
): FooterContent | null {
  if (!footer) return null;
  if (footer.skipTitle && slide.layout === 'title') return null;
  const content: FooterContent = {
    date: footer.date ? footerDate(now) : null,
    text: footer.text.trim() || null,
    number: footer.slideNumbers ? String(index + 1) : null,
  };
  return content.date || content.text || content.number ? content : null;
}
