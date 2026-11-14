'use client';

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  clampBox,
  resizeBox,
  snapMove,
  type Handle,
  type Slide,
  type SlideElement,
  type Theme,
} from '@/lib/slides/model';
import { cn } from '@/lib/ui/utils';
import { textBoxStyle } from '@/lib/slides/textStyle';
import { ElementView } from './SlideView';

type Box = Pick<SlideElement, 'x' | 'y' | 'w' | 'h'>;

interface Gesture {
  id: string;
  mode: 'move' | Handle;
  startX: number;
  startY: number;
  box: Box;
  moved: boolean;
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_POS: Record<Handle, string> = {
  nw: 'left-0 top-0 cursor-nwse-resize',
  n: 'left-1/2 top-0 cursor-ns-resize',
  ne: 'left-full top-0 cursor-nesw-resize',
  e: 'left-full top-1/2 cursor-ew-resize',
  se: 'left-full top-full cursor-nwse-resize',
  s: 'left-1/2 top-full cursor-ns-resize',
  sw: 'left-0 top-full cursor-nesw-resize',
  w: 'left-0 top-1/2 cursor-ew-resize',
};

/**
 * The slide being edited, scaled to fit. Click selects, drag moves (snapping to the slide's edges and centre and
 * to other elements), handles resize (corners keep a picture's shape; Shift keeps any shape), double-click or Enter
 * edits text in place. Changes are committed when a gesture ends, so one drag is one undo step.
 */
export function SlideCanvas({
  slide,
  theme,
  selectedId,
  editingId,
  onSelect,
  onBox,
  onStartEdit,
  onEndEdit,
  onKeyDown,
}: Readonly<{
  slide: Slide;
  theme: Theme;
  selectedId: string | null;
  editingId: string | null;
  onSelect: (id: string | null) => void;
  onBox: (id: string, box: Box) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: (id: string, text: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}>) {
  const outerRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const gestureRef = useRef<Gesture | null>(null);
  const [live, setLive] = useState<{ id: string; box: Box } | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });

  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const fit = () => {
      const { width, height } = outer.getBoundingClientRect();
      const next = Math.min((width - 48) / SLIDE_WIDTH, (height - 48) / SLIDE_HEIGHT);
      setScale(Math.max(0.1, next));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    return () => observer.disconnect();
  }, []);

  /** A pointer position on the 960 × 540 canvas. */
  const point = (e: { clientX: number; clientY: number }) => {
    const rect = slideRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const begin = (e: ReactPointerEvent, el: SlideElement, mode: Gesture['mode']) => {
    if (e.button !== 0 || editingId === el.id) return;
    e.stopPropagation();
    onSelect(el.id);
    outerRef.current?.focus({ preventScroll: true });
    const p = point(e);
    gestureRef.current = {
      id: el.id,
      mode,
      startX: p.x,
      startY: p.y,
      box: { x: el.x, y: el.y, w: el.w, h: el.h },
      moved: false,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const move = (e: ReactPointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    const p = point(e);
    const dx = p.x - g.startX;
    const dy = p.y - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < 2) return;
    g.moved = true;
    const el = slide.elements.find((x) => x.id === g.id);
    if (!el) return;
    if (g.mode === 'move') {
      const box = { ...g.box, x: g.box.x + dx, y: g.box.y + dy };
      const others = slide.elements.filter((x) => x.id !== g.id);
      const snapped = e.altKey ? { ...box, guides: { v: [], h: [] } } : snapMove(box, others);
      setGuides(snapped.guides);
      setLive({ id: g.id, box: clampBox({ ...box, x: snapped.x, y: snapped.y }) });
    } else {
      const keepRatio = e.shiftKey || el.kind === 'image';
      setLive({ id: g.id, box: resizeBox(g.box, g.mode, dx, el.h === 0 ? 0 : dy, keepRatio) });
    }
  };

  const end = () => {
    const g = gestureRef.current;
    gestureRef.current = null;
    setGuides({ v: [], h: [] });
    if (g?.moved && live && live.id === g.id) onBox(g.id, live.box);
    setLive(null);
  };

  return (
    <div
      ref={outerRef}
      // The canvas takes keyboard focus so Delete, arrows and copy/paste act on the selected element.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="application"
      aria-label="Slide canvas"
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/60 outline-none"
      onPointerDown={() => onSelect(null)}
      onKeyDown={onKeyDown}
    >
      <div
        className="relative shadow-md"
        style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div
          ref={slideRef}
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            transform: `scale(${scale})`,
            background: slide.background ?? theme.background,
          }}
        >
          {slide.elements.map((el) => {
            const box = live?.id === el.id ? live.box : el;
            const shown = { ...el, ...box };
            return (
              <div key={el.id}>
                <ElementView el={shown} theme={theme} hints hideText={editingId === el.id} />
                {/* The hit area (and editing box) sits over the drawing. */}
                <div
                  data-element={el.id}
                  aria-label={`${el.kind === 'image' ? 'Picture' : el.kind === 'shape' ? 'Shape' : 'Text box'}${el.text ? `: ${el.text.slice(0, 40)}` : ''}`}
                  className={cn(
                    'absolute',
                    editingId === el.id ? 'cursor-text' : 'cursor-move',
                    selectedId === el.id ? 'outline outline-2 outline-ring' : 'hover:outline hover:outline-ring/50'
                  )}
                  style={{
                    left: shown.x,
                    top: shown.y,
                    width: shown.w,
                    height: Math.max(shown.h, 6),
                    marginTop: shown.h === 0 ? -3 : 0,
                    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                    outlineWidth: 2 / scale,
                  }}
                  onPointerDown={(e) => begin(e, el, 'move')}
                  onDoubleClick={() => el.kind !== 'image' && el.h > 0 && onStartEdit(el.id)}
                >
                  {editingId === el.id && (
                    <TextEditor el={el} theme={theme} onDone={(text) => onEndEdit(el.id, text)} />
                  )}
                  {selectedId === el.id &&
                    editingId !== el.id &&
                    HANDLES.filter((h) => shown.h > 0 || h === 'e' || h === 'w').map((h) => (
                      <span
                        key={h}
                        aria-hidden="true"
                        data-handle={h}
                        className={cn(
                          'absolute -translate-x-1/2 -translate-y-1/2 rounded-sm border border-ring bg-background',
                          HANDLE_POS[h]
                        )}
                        style={{ width: 10 / scale, height: 10 / scale, borderWidth: 1 / scale }}
                        onPointerDown={(e) => begin(e, el, h)}
                      />
                    ))}
                </div>
              </div>
            );
          })}
          {guides.v.map((x) => (
            <div
              key={`v${x}`}
              className="pointer-events-none absolute top-0 bottom-0 bg-destructive"
              style={{ left: x, width: 1 / scale }}
            />
          ))}
          {guides.h.map((y) => (
            <div
              key={`h${y}`}
              className="pointer-events-none absolute right-0 left-0 bg-destructive"
              style={{ top: y, height: 1 / scale }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** In-place text editing: plain text only (the text is read back with innerText, never as HTML). */
function TextEditor({
  el,
  theme,
  onDone,
}: Readonly<{ el: SlideElement; theme: Theme; onDone: (text: string) => void }>) {
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.textContent = el.text;
    node.focus();
    // Caret at the end.
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Only on opening: the text is the editor's own while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone((ref.current?.innerText ?? '').replace(/\n$/, ''));
  };
  const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[el.style.valign];
  return (
    <div className="absolute inset-0 flex flex-col" style={{ justifyContent: justify }}>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label="Slide text"
        tabIndex={0}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        className="max-h-full overflow-hidden break-words whitespace-pre-wrap outline-none"
        style={textBoxStyle(el, theme)}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={finish}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            finish();
          }
        }}
      />
    </div>
  );
}
