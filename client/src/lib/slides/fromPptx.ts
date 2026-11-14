import JSZip from 'jszip';
import {
  ElementSchema,
  SHAPES,
  SLIDE_WIDTH,
  newId,
  type PresentationBody,
  type ShapeKind,
  type Slide,
  type SlideElement,
  type TextStyle,
} from './model';

// PowerPoint .pptx → Slides presentation. Reads the package's XML in a detached XML document (nothing is run or
// inserted into the page): text boxes and placeholders (positions from the slide, its layout or its master),
// preset shapes, pictures (PNG/JPEG/GIF/WebP), lines, groups, solid backgrounds and speaker notes. Charts, SmartArt,
// tables, animations and gradient/picture fills are skipped (counted in `skipped`).

export interface ImportedPresentation {
  body: PresentationBody;
  /** Elements that could not be brought over. */
  skipped: number;
}

const MAX_SLIDES = 500;
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

type El = Element;

const kids = (el: El | null | undefined, name: string): El[] =>
  el ? Array.from(el.children).filter((c) => c.nodeName === name) : [];
const kid = (el: El | null | undefined, name: string): El | null => kids(el, name)[0] ?? null;
/** First descendant along a path of child names. */
const path = (el: El | null | undefined, ...names: string[]): El | null =>
  names.reduce<El | null>((node, name) => kid(node, name), el ?? null);

interface Xfrm {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}

function readXfrm(xfrm: El | null): Xfrm | null {
  const off = kid(xfrm, 'a:off');
  const ext = kid(xfrm, 'a:ext');
  if (!xfrm || !off || !ext) return null;
  return {
    x: Number(off.getAttribute('x')) || 0,
    y: Number(off.getAttribute('y')) || 0,
    w: Number(ext.getAttribute('cx')) || 0,
    h: Number(ext.getAttribute('cy')) || 0,
    rot: (Number(xfrm.getAttribute('rot')) || 0) / 60000,
  };
}

/** Maps a group's child coordinates to the slide (EMU). */
type Transform = (x: Xfrm) => Xfrm;
const identity: Transform = (x) => x;

function groupTransform(grpSpPr: El | null, outer: Transform): Transform {
  const xfrm = kid(grpSpPr, 'a:xfrm');
  const own = readXfrm(xfrm);
  const chOff = kid(xfrm, 'a:chOff');
  const chExt = kid(xfrm, 'a:chExt');
  if (!own || !chOff || !chExt) return outer;
  const cx = Number(chOff.getAttribute('x')) || 0;
  const cy = Number(chOff.getAttribute('y')) || 0;
  const sx = own.w / (Number(chExt.getAttribute('cx')) || own.w || 1);
  const sy = own.h / (Number(chExt.getAttribute('cy')) || own.h || 1);
  return (x) =>
    outer({ x: own.x + (x.x - cx) * sx, y: own.y + (x.y - cy) * sy, w: x.w * sx, h: x.h * sy, rot: x.rot + own.rot });
}

class Colors {
  constructor(private readonly scheme: Map<string, string>) {}

  static fromTheme(themeDoc: Document | null): Colors {
    const scheme = new Map<string, string>();
    const clr = themeDoc?.getElementsByTagName('a:clrScheme')[0];
    for (const c of Array.from(clr?.children ?? [])) {
      const name = c.nodeName.replace(/^a:/, '');
      const srgb = kid(c, 'a:srgbClr')?.getAttribute('val');
      const sys = kid(c, 'a:sysClr')?.getAttribute('lastClr');
      const value = srgb ?? sys;
      if (value) scheme.set(name, `#${value.toLowerCase()}`);
    }
    const alias: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
    for (const [a, b] of Object.entries(alias)) {
      const v = scheme.get(b);
      if (v) scheme.set(a, v);
    }
    return new Colors(scheme);
  }

  /** `#rrggbb` from an element holding a:srgbClr / a:schemeClr / a:sysClr (e.g. a:solidFill). */
  read(holder: El | null): string | null {
    const srgb = kid(holder, 'a:srgbClr')?.getAttribute('val');
    if (srgb && /^[0-9a-f]{6}$/i.test(srgb)) return `#${srgb.toLowerCase()}`;
    const sys = kid(holder, 'a:sysClr')?.getAttribute('lastClr');
    if (sys && /^[0-9a-f]{6}$/i.test(sys)) return `#${sys.toLowerCase()}`;
    const scheme = kid(holder, 'a:schemeClr')?.getAttribute('val');
    return (scheme && this.scheme.get(scheme)) ?? null;
  }
}

interface Part {
  path: string;
  doc: Document;
  rels: Map<string, { target: string; type: string }>;
}

async function readPart(zip: JSZip, partPath: string): Promise<Part | null> {
  const file = zip.file(partPath);
  if (!file) return null;
  const doc = new DOMParser().parseFromString(await file.async('string'), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const dir = partPath.slice(0, partPath.lastIndexOf('/'));
  const relsPath = `${dir}/_rels/${partPath.slice(dir.length + 1)}.rels`;
  const rels = new Map<string, { target: string; type: string }>();
  const relsFile = zip.file(relsPath);
  if (relsFile) {
    const relsDoc = new DOMParser().parseFromString(await relsFile.async('string'), 'application/xml');
    for (const r of Array.from(relsDoc.getElementsByTagName('Relationship'))) {
      const id = r.getAttribute('Id');
      const target = r.getAttribute('Target');
      if (!id || !target || r.getAttribute('TargetMode') === 'External') continue;
      rels.set(id, { target: resolve(dir, target), type: r.getAttribute('Type') ?? '' });
    }
  }
  return { path: partPath, doc, rels };
}

/** A relationship target relative to the part's folder ("../media/image1.png"). */
function resolve(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = dir.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const relOfType = (part: Part | null, suffix: string) =>
  [...(part?.rels.values() ?? [])].find((r) => r.type.endsWith(suffix))?.target ?? null;

type PlaceholderKind = NonNullable<SlideElement['placeholder']>;

function placeholderOf(sp: El): { kind: PlaceholderKind; type: string; idx: string } | null {
  const ph = path(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph') ?? path(sp, 'p:nvPicPr', 'p:nvPr', 'p:ph');
  if (!ph) return null;
  const type = ph.getAttribute('type') ?? 'body';
  const idx = ph.getAttribute('idx') ?? '';
  if (['dt', 'ftr', 'sldNum', 'hdr'].includes(type)) return { kind: 'body', type, idx };
  const kind: PlaceholderKind =
    type === 'title' || type === 'ctrTitle' ? 'title' : type === 'subTitle' ? 'subtitle' : 'body';
  return { kind, type, idx };
}

/** The matching placeholder shape in a layout or master (same idx, else same type). */
function findPlaceholder(part: Part | null, type: string, idx: string): El | null {
  if (!part) return null;
  const shapes = Array.from(part.doc.getElementsByTagName('p:sp'));
  const norm = (t: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t);
  return (
    (idx && shapes.find((s) => path(s, 'p:nvSpPr', 'p:nvPr', 'p:ph')?.getAttribute('idx') === idx)) ||
    shapes.find((s) => norm(path(s, 'p:nvSpPr', 'p:nvPr', 'p:ph')?.getAttribute('type') ?? 'body') === norm(type)) ||
    null
  );
}

interface Context {
  scale: number;
  colors: Colors;
  zip: JSZip;
  layout: Part | null;
  master: Part | null;
  skipped: number;
}

const ALIGN: Record<string, TextStyle['align']> = {
  l: 'left',
  ctr: 'center',
  r: 'right',
  just: 'left',
  dist: 'center',
};
const ANCHOR: Record<string, TextStyle['valign']> = { t: 'top', ctr: 'middle', b: 'bottom' };
const DEFAULT_SIZE: Record<PlaceholderKind, number> = { title: 40, subtitle: 24, body: 24 };

/** Text and the first run's look (one style per box, as the editor has). */
function readText(
  txBody: El | null,
  ctx: Context,
  ph: PlaceholderKind | undefined,
  inherited: El[]
): { text: string; style: Partial<TextStyle> } {
  const paragraphs = kids(txBody, 'a:p');
  const lines = paragraphs.map((p) =>
    Array.from(p.children)
      .map((c) =>
        c.nodeName === 'a:r' || c.nodeName === 'a:fld'
          ? (kid(c, 'a:t')?.textContent ?? '')
          : c.nodeName === 'a:br'
            ? '\n'
            : ''
      )
      .join('')
  );
  const text = lines.join('\n').replace(/\s+$/, '');
  const firstRun = paragraphs.flatMap((p) => kids(p, 'a:r'))[0] ?? null;
  const rPr = kid(firstRun, 'a:rPr');
  const pPr = kid(paragraphs[0], 'a:pPr');
  // Unset properties fall back to the layout/master placeholder's list style (level 1).
  const lvl = (el: El | null) => path(el, 'p:txBody', 'a:lstStyle', 'a:lvl1pPr');
  const defaults = inherited.map(lvl).filter((x): x is El => !!x);
  const defRPr = defaults.map((d) => kid(d, 'a:defRPr')).filter((x): x is El => !!x);
  const attr = (name: string, own: El | null, fallbacks: El[]) =>
    own?.getAttribute(name) ?? fallbacks.map((f) => f.getAttribute(name)).find((v) => v !== null) ?? null;

  const style: Partial<TextStyle> = {};
  const sz = attr('sz', rPr, defRPr);
  style.fontSize = sz ? Number(sz) / 100 : ph ? DEFAULT_SIZE[ph] : 18;
  if (attr('b', rPr, defRPr) === '1') style.bold = true;
  if (attr('i', rPr, defRPr) === '1') style.italic = true;
  const u = attr('u', rPr, defRPr);
  if (u && u !== 'none') style.underline = true;
  const color =
    ctx.colors.read(kid(rPr, 'a:solidFill')) ?? defRPr.map((d) => ctx.colors.read(kid(d, 'a:solidFill'))).find(Boolean);
  if (color) style.color = color;
  const latin = kid(rPr, 'a:latin')?.getAttribute('typeface');
  if (latin && !latin.startsWith('+') && /^[\p{L}\p{N} ._-]{1,64}$/u.test(latin)) style.fontFamily = latin;
  const algn = attr('algn', pPr, defaults);
  if (algn && ALIGN[algn]) style.align = ALIGN[algn];
  const anchor = kid(txBody, 'a:bodyPr')?.getAttribute('anchor');
  if (anchor && ANCHOR[anchor]) style.valign = ANCHOR[anchor];
  else if (ph === 'title') style.valign = 'middle';
  const bulletOwn =
    pPr && (kid(pPr, 'a:buChar') || kid(pPr, 'a:buAutoNum') ? true : kid(pPr, 'a:buNone') ? false : null);
  style.bullets = bulletOwn ?? ph === 'body';
  return { text, style };
}

function shapeKind(prst: string | null | undefined): ShapeKind | null {
  if (!prst) return null;
  if ((SHAPES as readonly string[]).includes(prst)) return prst as ShapeKind;
  if (prst === 'flowChartProcess') return 'rect';
  if (prst === 'flowChartAlternateProcess' || prst === 'snipRoundRect') return 'roundRect';
  if (prst === 'straightConnector1') return 'line';
  return null;
}

function toBox(x: Xfrm, ctx: Context) {
  return {
    x: x.x * ctx.scale,
    y: x.y * ctx.scale,
    w: Math.max(1, x.w * ctx.scale),
    h: x.h * ctx.scale,
    rotation: x.rot,
  };
}

function readShape(sp: El, ctx: Context, transform: Transform): SlideElement | null {
  const spPr = kid(sp, 'p:spPr');
  const ph = placeholderOf(sp);
  if (ph && ['dt', 'ftr', 'sldNum', 'hdr'].includes(ph.type)) return null;
  const layoutSp = ph ? findPlaceholder(ctx.layout, ph.type, ph.idx) : null;
  const masterSp = ph ? findPlaceholder(ctx.master, ph.type, ph.idx) : null;
  const xfrm =
    readXfrm(kid(spPr, 'a:xfrm')) ??
    readXfrm(path(layoutSp, 'p:spPr', 'a:xfrm')) ??
    readXfrm(path(masterSp, 'p:spPr', 'a:xfrm'));
  if (!xfrm) return null;
  const prst = kid(spPr, 'a:prstGeom')?.getAttribute('prst');
  const shape = shapeKind(prst);
  if (prst && !shape && !kid(sp, 'p:txBody')) {
    ctx.skipped++;
    return null;
  }
  const fill = ctx.colors.read(kid(spPr, 'a:solidFill'));
  const ln = kid(spPr, 'a:ln');
  const stroke = kid(ln, 'a:noFill') ? null : ctx.colors.read(kid(ln, 'a:solidFill'));
  const strokeWidth = ln?.getAttribute('w') ? Number(ln.getAttribute('w')) / 12700 / 0.75 : stroke ? 1 : 0;
  const inherited = [layoutSp, masterSp].filter((x): x is El => !!x);
  const { text, style } = readText(kid(sp, 'p:txBody'), ctx, ph?.kind, inherited);
  const isShape = !!shape && shape !== 'rect' ? true : shape === 'rect' && (!!fill || !!stroke) && !ph && !text;
  const parsed = ElementSchema.safeParse({
    id: newId(),
    kind: isShape ? 'shape' : 'text',
    ...toBox(transform(xfrm), ctx),
    ...(isShape ? { shape } : {}),
    ...(ph ? { placeholder: ph.kind } : {}),
    fill,
    stroke,
    strokeWidth: Math.min(50, Math.round(strokeWidth * 10) / 10),
    text,
    style,
  });
  if (!parsed.success) {
    ctx.skipped++;
    return null;
  }
  return parsed.data;
}

async function readPicture(pic: El, part: Part, ctx: Context, transform: Transform): Promise<SlideElement | null> {
  const xfrm = readXfrm(path(pic, 'p:spPr', 'a:xfrm'));
  const embed = path(pic, 'p:blipFill', 'a:blip')?.getAttribute('r:embed');
  const target = embed ? part.rels.get(embed)?.target : undefined;
  const ext = target?.split('.').pop()?.toLowerCase() ?? '';
  const mime = IMAGE_TYPES[ext];
  const file = target ? ctx.zip.file(target) : null;
  if (!xfrm || !mime || !file) {
    ctx.skipped++;
    return null;
  }
  const data = await file.async('base64');
  return ElementSchema.parse({
    id: newId(),
    kind: 'image',
    ...toBox(transform(xfrm), ctx),
    src: `data:${mime};base64,${data}`,
  });
}

function readConnector(cxn: El, ctx: Context, transform: Transform): SlideElement | null {
  const spPr = kid(cxn, 'p:spPr');
  const xfrm = readXfrm(kid(spPr, 'a:xfrm'));
  if (!xfrm) return null;
  const ln = kid(spPr, 'a:ln');
  return ElementSchema.parse({
    id: newId(),
    kind: 'shape',
    shape: 'line',
    ...toBox(transform(xfrm), ctx),
    stroke: ctx.colors.read(kid(ln, 'a:solidFill')) ?? '#000000',
    strokeWidth: ln?.getAttribute('w') ? Math.min(50, Number(ln.getAttribute('w')) / 12700 / 0.75) : 1,
  });
}

async function readTree(tree: El | null, part: Part, ctx: Context, transform: Transform): Promise<SlideElement[]> {
  const out: SlideElement[] = [];
  for (const child of Array.from(tree?.children ?? [])) {
    if (child.nodeName === 'p:sp') {
      const el = readShape(child, ctx, transform);
      if (el) out.push(el);
    } else if (child.nodeName === 'p:pic') {
      const el = await readPicture(child, part, ctx, transform);
      if (el) out.push(el);
    } else if (child.nodeName === 'p:cxnSp') {
      const el = readConnector(child, ctx, transform);
      if (el) out.push(el);
    } else if (child.nodeName === 'p:grpSp') {
      out.push(...(await readTree(child, part, ctx, groupTransform(kid(child, 'p:grpSpPr'), transform))));
    } else if (child.nodeName === 'p:graphicFrame') {
      ctx.skipped++;
    }
  }
  return out;
}

function background(part: Part | null, colors: Colors): string | null {
  const bg = part?.doc.getElementsByTagName('p:bg')[0];
  return colors.read(path(bg, 'p:bgPr', 'a:solidFill'));
}

async function readNotes(zip: JSZip, slide: Part): Promise<string> {
  const target = relOfType(slide, '/notesSlide');
  const notes = target ? await readPart(zip, target) : null;
  if (!notes) return '';
  const body = Array.from(notes.doc.getElementsByTagName('p:sp')).find(
    (s) => path(s, 'p:nvSpPr', 'p:nvPr', 'p:ph')?.getAttribute('type') === 'body'
  );
  return kids(kid(body, 'p:txBody'), 'a:p')
    .map((p) =>
      Array.from(p.getElementsByTagName('a:t'))
        .map((t) => t.textContent ?? '')
        .join('')
    )
    .join('\n')
    .trim();
}

export async function pptxToPresentation(bytes: Uint8Array): Promise<ImportedPresentation> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("That file isn't a PowerPoint presentation.");
  }
  const pres = await readPart(zip, 'ppt/presentation.xml');
  if (!pres) throw new Error("That file isn't a PowerPoint presentation.");
  const size = pres.doc.getElementsByTagName('p:sldSz')[0];
  const cx = Number(size?.getAttribute('cx')) || 9144000;
  const themePath = relOfType(pres, '/theme');
  const themePart = themePath ? await readPart(zip, themePath) : null;
  const colors = Colors.fromTheme(themePart?.doc ?? null);
  const ids = Array.from(pres.doc.getElementsByTagName('p:sldId')).slice(0, MAX_SLIDES);
  const ctxBase = { scale: SLIDE_WIDTH / cx, colors, zip, skipped: 0 };
  const slides: Slide[] = [];
  let skipped = 0;
  for (const id of ids) {
    const target = pres.rels.get(id.getAttribute('r:id') ?? '')?.target;
    const part = target ? await readPart(zip, target) : null;
    if (!part) continue;
    const layoutPath = relOfType(part, '/slideLayout');
    const layout = layoutPath ? await readPart(zip, layoutPath) : null;
    const masterPath = relOfType(layout, '/slideMaster');
    const master = masterPath ? await readPart(zip, masterPath) : null;
    const ctx: Context = { ...ctxBase, layout, master, skipped: 0 };
    const tree = part.doc.getElementsByTagName('p:spTree')[0] ?? null;
    const elements = await readTree(tree, part, ctx, identity);
    skipped += ctx.skipped;
    slides.push({
      id: newId(),
      layout: 'blank',
      background: background(part, colors) ?? background(layout, colors) ?? background(master, colors) ?? '#ffffff',
      elements,
      notes: await readNotes(zip, part),
    });
  }
  if (!slides.length) throw new Error('No slides were found in that presentation.');
  return { body: { themeId: 'office', slides }, skipped };
}
