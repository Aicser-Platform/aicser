import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { selectionPending } from './selectionSync';

// Word-like pages in the Docs editor. The document stays one ProseMirror editor; after each change this measures
// its blocks (list items one by one) and puts a blank gap (a widget decoration, never saved) in front of the first
// block that would cross the bottom of a page, so that block starts on the next page. A page break node always
// moves what follows to the next page. The editor draws the page sheets behind the text (DocumentEditor).
// A single block taller than a page (a long table or code block) is not split: it runs on over the gap.

/** Page layout in CSS px of the editor's own coordinates (zoom does not change them). */
export interface PageGeometry {
  /** Page height plus the gap between two pages: page k's text area starts at k × stride. */
  stride: number;
  /** Height of a page's text area (page height minus top and bottom margins). */
  contentHeight: number;
}

export interface PageUnit {
  pos: number;
  /** Top of the block (border box) without any gaps, relative to the top of the first page's text area. */
  top: number;
  height: number;
  pageBreak?: boolean;
}

export interface PageGap {
  pos: number;
  height: number;
}

/** Where gaps go so no block crosses a page bottom, and how many pages that makes. Pure (unit-tested). */
export function layoutPages(units: readonly PageUnit[], g: PageGeometry): { gaps: PageGap[]; pages: number } {
  const gaps: PageGap[] = [];
  let shift = 0;
  let page = 0;
  let forceNext = false;
  let bottom = 0;
  for (const unit of units) {
    const top = unit.top + shift;
    const k = Math.max(page, Math.floor(top / g.stride));
    const pageTop = k * g.stride;
    const pageEnd = pageTop + g.contentHeight;
    const fits = unit.height <= g.contentHeight;
    const crosses = top + unit.height > pageEnd + 0.5 && fits && top > pageTop + 2;
    if (forceNext || top >= pageEnd || crosses) {
      // Whole pixels: the browser measures blocks in whole pixels, so a fractional gap came back ±0.5 px off on the
      // next measure and the gaps were redrawn forever (each redraw scrolled the page back to the cursor).
      const height = Math.round((k + 1) * g.stride - top);
      gaps.push({ pos: unit.pos, height });
      shift += height;
      page = k + 1;
    } else {
      page = k;
    }
    forceNext = !!unit.pageBreak;
    bottom = unit.top + shift + unit.height;
  }
  let pages = Math.max(1, Math.floor(Math.max(0, bottom - 1) / g.stride) + 1);
  if (forceNext) pages += 1;
  return { gaps, pages };
}

/** Blocks laid out one by one: list items and quoted blocks rather than the whole list or quote. */
const CONTAINERS = new Set(['bulletList', 'orderedList', 'taskList', 'blockquote']);

function unitPositions(doc: PMNode): Array<{ pos: number; pageBreak: boolean }> {
  const out: Array<{ pos: number; pageBreak: boolean }> = [];
  const walk = (node: PMNode, start: number) =>
    node.forEach((child, offset) => {
      const pos = start + offset;
      if (CONTAINERS.has(child.type.name)) walk(child, pos + 1);
      else out.push({ pos, pageBreak: child.type.name === 'pageBreak' });
    });
  walk(doc, 0);
  return out;
}

/** Top of `el` relative to `root` (the editor, `position: relative`), in unzoomed CSS px. */
function topIn(el: HTMLElement, root: HTMLElement): number | null {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return node === root ? top : null;
}

interface GapSpec {
  gapHeight: number;
}

/** A blank gap of `height` px in front of the block at `pos`: the rest of the page, the space between pages and
 * the next page's top margin. Never part of the document. */
const gapDecoration = ({ pos, height }: PageGap) =>
  Decoration.widget(
    pos,
    () => {
      const el = document.createElement('div');
      el.className = 'doc-page-gap';
      el.contentEditable = 'false';
      el.setAttribute('aria-hidden', 'true');
      el.style.height = `${height}px`;
      return el;
    },
    { side: -1, ignoreSelection: true, key: `gap-${height.toFixed(1)}`, gapHeight: height }
  );

export const paginationKey = new PluginKey<DecorationSet>('pagination');

export interface PaginationStorage {
  geometry: PageGeometry | null;
  onPages: ((pages: number) => void) | null;
  /** Re-measure soon (set by the plugin's view). */
  schedule: (() => void) | null;
}

declare module '@tiptap/core' {
  interface Storage {
    pagination: PaginationStorage;
  }
}

/**
 * Redrawing the gaps makes ProseMirror write its selection back to the page. Right after a click (or while keys
 * are arriving) the page's selection can be newer than ProseMirror's, so take it from the page first: otherwise the
 * click would be undone and the next key would land where the cursor was before.
 */
function keepDomSelection(view: EditorView, tr: Transaction) {
  if (!view.hasFocus() || !(view.state.selection instanceof TextSelection)) return;
  const sel = view.dom.ownerDocument.getSelection();
  if (!sel?.anchorNode || !sel.focusNode || !view.dom.contains(sel.anchorNode)) return;
  try {
    const anchor = view.posAtDOM(sel.anchorNode, sel.anchorOffset);
    const head = view.posAtDOM(sel.focusNode, sel.focusOffset);
    const { selection } = view.state;
    if (anchor === selection.anchor && head === selection.head) return;
    tr.setSelection(TextSelection.between(tr.doc.resolve(anchor), tr.doc.resolve(head)));
  } catch {
    // The page's selection is somewhere ProseMirror can't map (e.g. inside a gap): keep ProseMirror's.
  }
}

/** Lays the pages out again. False = try later (an input method is composing: a redraw would break it). */
function measure(view: EditorView, storage: PaginationStorage): boolean {
  const g = storage.geometry;
  if (!g || !view.dom.isConnected) return true;
  if (view.composing) return false;
  const current = (paginationKey.getState(view.state) ?? DecorationSet.empty)
    .find()
    .map((d) => ({ pos: d.from, height: (d.spec as GapSpec).gapHeight }))
    .sort((a, b) => a.pos - b.pos);

  const units: PageUnit[] = [];
  let gi = 0;
  let before = 0;
  for (const { pos, pageBreak } of unitPositions(view.state.doc)) {
    while (gi < current.length && current[gi]!.pos <= pos) before += current[gi++]!.height;
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) continue;
    const top = topIn(dom, view.dom);
    if (top === null) continue;
    units.push({ pos, top: top - before, height: dom.offsetHeight, pageBreak });
  }

  const { gaps, pages } = layoutPages(units, g);
  storage.onPages?.(pages);
  const same =
    gaps.length === current.length &&
    // Within a pixel is the same layout: redrawing for less only flickers (and moves the view in WebKit).
    gaps.every((gap, i) => gap.pos === current[i]!.pos && Math.abs(gap.height - current[i]!.height) <= 1);
  if (same) return true;
  const tr = view.state.tr.setMeta(paginationKey, gaps.map(gapDecoration)).setMeta('addToHistory', false);
  keepDomSelection(view, tr);
  view.dispatch(tr);
  return true;
}

/** The pages extension (editor only: import and export never lay out pages). */
export const Pagination = Extension.create<object, PaginationStorage>({
  name: 'pagination',

  addStorage() {
    return { geometry: null, onPages: null, schedule: null };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<DecorationSet>({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const next = tr.getMeta(paginationKey) as Decoration[] | undefined;
            return next ? DecorationSet.create(tr.doc, next) : set.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations: (state) => paginationKey.getState(state) },
        view: (view) => {
          let frame = 0;
          let retry = 0;
          let waited = 0;
          const schedule = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
              frame = 0;
              // A click ProseMirror hasn't read yet: wait for it (briefly: a cursor it maps differently must not
              // stop the pages), or the new gaps would undo it.
              if (waited < 10 && selectionPending(view)) {
                waited += 1;
                retry = window.setTimeout(schedule, 30);
                return;
              }
              waited = 0;
              if (!measure(view, storage)) retry = window.setTimeout(schedule, 200);
            });
          };
          // Heights also change without a transaction: images loading, fonts arriving, page setup, zoom.
          const observer = new ResizeObserver(schedule);
          observer.observe(view.dom);
          storage.schedule = schedule;
          schedule();
          return {
            update: schedule,
            destroy: () => {
              cancelAnimationFrame(frame);
              clearTimeout(retry);
              observer.disconnect();
              storage.schedule = null;
            },
          };
        },
      }),
    ];
  },
});

/** Tells the editor the page size (and where to report the page count), then lays the pages out again. */
export function setPageGeometry(editor: Editor, geometry: PageGeometry, onPages: (pages: number) => void) {
  const storage = editor.storage.pagination;
  storage.geometry = geometry;
  storage.onPages = onPages;
  storage.schedule?.();
}
