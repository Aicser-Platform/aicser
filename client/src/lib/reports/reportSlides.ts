import { shownSections, type Report, type ReportKpi, type ReportSection } from './report';
import {
  ElementSchema,
  PX_PER_PT,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  newId,
  newSlide,
  textElement,
  type PresentationBody,
  type Slide,
  type SlideElement,
  type TextStyle,
} from '@/lib/slides/model';
import { renderChartImage, sectionChartOption } from './chartImage';
import { PRIORITY_LABEL, headlineKpis, plainText, reportByline, textBlocks } from './reportText';

const ACCENT = '#0e7490';
const MUTED = '#656d76';
const TILE = '#f0f6f8';
const MARGIN = 60;
const WIDTH = SLIDE_WIDTH - MARGIN * 2;

const style = (patch: Partial<TextStyle>): TextStyle => ({
  fontSize: 18,
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
  valign: 'top',
  bullets: false,
  ...patch,
});

/** Lines `text` wraps to when a line holds `perLine` characters (greedy, word by word, like the slide text box). */
function wrappedLines(text: string, perLine: number): number {
  let count = 0;
  for (const paragraph of text.split('\n')) {
    let line = 0;
    count += 1;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const need = line ? line + 1 + word.length : word.length;
      if (need <= perLine) line = need;
      else {
        // A word longer than a line breaks over several.
        count += line ? 1 : 0;
        count += Math.max(0, Math.ceil(word.length / perLine) - 1);
        line = word.length % perLine || perLine;
      }
    }
  }
  return count;
}

/**
 * The largest font size (points, from `max` down to `min`) at which `text` fits a `w` × `h` box: words wrapped
 * with an average bold character width of 0.6 em, 1.2 line height. Long report titles otherwise ran out of the
 * title box (it is bottom-aligned, so the first line was cut off).
 */
export function fitFontSize(text: string, w: number, h: number, max: number, min = 18): number {
  for (let size = max; size > min; size -= 2) {
    const px = size * PX_PER_PT;
    const perLine = Math.max(1, Math.floor(w / (px * 0.6)));
    if (wrappedLines(text, perLine) * px * 1.2 <= h) return size;
  }
  return min;
}

/** Shortens text to `max` characters at a word boundary (the full text goes into the speaker notes). */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Plain lines from AI text (paragraphs and bullets), at most `lines` of them. */
function lines(value: string, count: number, max = 160): string[] {
  return textBlocks(value)
    .map((b) => clip(b.text, max))
    .slice(0, count);
}

function titleSlide(title: string, subtitle?: string): Slide {
  const slide = newSlide('title-only');
  const [titleBox] = slide.elements;
  if (titleBox) {
    titleBox.text = title;
    titleBox.style = {
      ...titleBox.style,
      fontSize: fitFontSize(title, titleBox.w - 20, titleBox.h, titleBox.style.fontSize),
    };
  }
  if (subtitle) {
    slide.elements.push(
      textElement({ x: MARGIN, y: 112, w: WIDTH, h: 30, text: subtitle, style: style({ fontSize: 14, color: MUTED }) })
    );
  }
  return slide;
}

/** KPI tiles (up to four per row) from `top` down. */
function kpiTiles(kpis: ReportKpi[], top: number, height = 110): SlideElement[] {
  const perRow = Math.min(4, kpis.length);
  const gap = 16;
  const w = (WIDTH - gap * (perRow - 1)) / perRow;
  return kpis.slice(0, 8).flatMap((kpi, i) => {
    const x = MARGIN + (i % perRow) * (w + gap);
    const y = top + Math.floor(i / perRow) * (height + gap);
    return [
      textElement({ x, y, w, h: height, fill: TILE, text: '', style: style({}) }),
      ElementSchema.parse({ id: newId(), kind: 'shape', shape: 'rect', x, y, w: 5, h: height, fill: ACCENT }),
      textElement({
        x: x + 18,
        y: y + 14,
        w: w - 28,
        h: 24,
        text: clip(kpi.label, 40),
        style: style({ fontSize: 13, color: MUTED }),
      }),
      textElement({
        x: x + 18,
        y: y + 44,
        w: w - 28,
        h: 50,
        text: clip(kpi.value, 20),
        style: style({ fontSize: 30, bold: true }),
      }),
    ];
  });
}

function sectionSlide(section: ReportSection, index: number): Slide {
  const slide = titleSlide(`${index + 1}. ${section.title}`);
  const top = 130;
  let textTop = top;
  if (section.keyMetric && section.keyMetricValue) {
    slide.elements.push(
      textElement({
        x: MARGIN,
        y: top - 18,
        w: WIDTH,
        h: 30,
        text: `${section.keyMetric}: ${section.keyMetricValue}`,
        style: style({ fontSize: 16, bold: true, color: ACCENT }),
      })
    );
    textTop += 24;
  }
  const option = sectionChartOption(section);
  const image = option ? renderChartImage(option, { width: 600, height: 340, type: 'png' }) : null;
  const kpis = section.type === 'kpi' ? section.kpis : [];
  if (image) {
    // Chart on the left, the story on the right.
    slide.elements.push(
      ElementSchema.parse({ id: newId(), kind: 'image', x: MARGIN, y: textTop, w: 540, h: 306, src: image.dataUrl })
    );
    const story = lines(section.narrative, 5, 140);
    if (story.length) {
      slide.elements.push(
        textElement({
          x: MARGIN + 560,
          y: textTop,
          w: WIDTH - 560,
          h: SLIDE_HEIGHT - textTop - 40,
          text: story.join('\n'),
          style: style({ fontSize: 16, bullets: story.length > 1 }),
        })
      );
    }
  } else if (kpis.length) {
    slide.elements.push(...kpiTiles(kpis, textTop));
    const rows = Math.ceil(Math.min(kpis.length, 8) / Math.min(4, kpis.length));
    const below = textTop + rows * 126 + 10;
    const story = lines(section.narrative, 3);
    if (story.length && below < SLIDE_HEIGHT - 60) {
      slide.elements.push(
        textElement({
          x: MARGIN,
          y: below,
          w: WIDTH,
          h: SLIDE_HEIGHT - below - 30,
          text: story.join('\n'),
          style: style({ fontSize: 16 }),
        })
      );
    }
  } else {
    const story = lines(section.narrative, 6);
    slide.elements.push(
      textElement({
        x: MARGIN,
        y: textTop,
        w: WIDTH,
        h: SLIDE_HEIGHT - textTop - 40,
        text: story.join('\n'),
        style: style({ fontSize: 18, bullets: story.length > 1 }),
      })
    );
  }
  slide.notes = section.narrative ? plainText(section.narrative) : '';
  return slide;
}

function bulletSlide(title: string, items: string[], notes = ''): Slide {
  const slide = titleSlide(title);
  slide.elements.push(
    textElement({
      x: MARGIN,
      y: 130,
      w: WIDTH,
      h: SLIDE_HEIGHT - 170,
      text: items.join('\n'),
      style: style({ fontSize: 18, bullets: true }),
    })
  );
  slide.notes = notes;
  return slide;
}

/**
 * The report as a presentation (Slides model, 960×540): a title slide, the executive summary, key metrics, one slide
 * per section (chart + its story; the full text in the speaker notes), recommendations and next questions.
 */
export function reportToPresentation(
  report: Report,
  date = new Date()
): { title: string; body: PresentationBody; meta: Record<string, unknown> } {
  const title = report.title || 'Analysis report';
  const cover = newSlide('title');
  const [coverTitle, coverSubtitle] = cover.elements;
  if (coverTitle) {
    coverTitle.text = title;
    coverTitle.style = {
      ...coverTitle.style,
      fontSize: fitFontSize(title, coverTitle.w - 20, coverTitle.h, coverTitle.style.fontSize),
    };
  }
  if (coverSubtitle) coverSubtitle.text = reportByline(report, date);
  cover.elements.push(
    ElementSchema.parse({ id: newId(), kind: 'shape', shape: 'rect', x: 440, y: 290, w: 80, h: 5, fill: ACCENT })
  );
  // The accent bar sits between title and subtitle: nudge the subtitle down.
  if (coverSubtitle) coverSubtitle.y += 12;
  const slides: Slide[] = [cover];

  if (report.summary) {
    slides.push(bulletSlide('Executive summary', lines(report.summary, 6), plainText(report.summary)));
  }
  const kpis = headlineKpis(report.sections);
  if (kpis.length) {
    const slide = titleSlide('Key metrics');
    slide.elements.push(...kpiTiles(kpis, 140));
    slides.push(slide);
  }
  shownSections(report).forEach((section, i) => slides.push(sectionSlide(section, i)));
  if (report.recommendations.length) {
    slides.push(
      bulletSlide(
        'Recommendations',
        report.recommendations.slice(0, 6).map((rec) => {
          const priority = PRIORITY_LABEL[rec.priority];
          const head = `${plainText(rec.title)}${priority ? ` (${priority})` : ''}`;
          return clip(rec.action ? `${head}: ${plainText(rec.action)}` : head, 170);
        }),
        report.recommendations
          .map((r) => [r.title, r.action, r.rationale && `Why: ${r.rationale}`].filter(Boolean).join(' — '))
          .join('\n')
      )
    );
  }
  if (report.followUps.length) {
    slides.push(
      bulletSlide(
        'Questions to explore next',
        report.followUps.slice(0, 6).map((q) => clip(plainText(q), 160))
      )
    );
  }
  return { title, body: { themeId: 'office', slides }, meta: { slides: slides.length } };
}
