import {
  PLACEHOLDER_HINTS,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type Slide,
  type SlideElement,
  type Theme,
} from '@/lib/slides/model';
import { textBoxStyle } from '@/lib/slides/textStyle';

// Drawing a slide (thumbnails, the editor canvas, presenting). Everything is laid out on the 960 × 540 canvas and
// scaled with a transform, so text wraps the same at every size.

function ShapeGraphic({ el }: Readonly<{ el: SlideElement }>) {
  const { w, h } = el;
  const fill = el.fill ?? 'none';
  const stroke = el.stroke ?? 'none';
  const sw = el.stroke ? Math.max(el.strokeWidth, 1) : 0;
  const common = { fill, stroke, strokeWidth: sw, vectorEffect: 'non-scaling-stroke' as const };
  let shape;
  switch (el.shape) {
    case 'ellipse':
      shape = <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />;
      break;
    case 'roundRect': {
      const r = Math.min(w, h) * 0.16;
      shape = <rect width={w} height={h} rx={r} ry={r} {...common} />;
      break;
    }
    case 'triangle':
      shape = <polygon points={`${w / 2},0 ${w},${h} 0,${h}`} {...common} />;
      break;
    case 'diamond':
      shape = <polygon points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} {...common} />;
      break;
    case 'rightArrow':
      shape = (
        <polygon
          points={`0,${h * 0.25} ${w * 0.6},${h * 0.25} ${w * 0.6},0 ${w},${h / 2} ${w * 0.6},${h} ${w * 0.6},${h * 0.75} 0,${h * 0.75}`}
          {...common}
        />
      );
      break;
    case 'line':
      shape = (
        <line x1={0} y1={0} x2={w} y2={h} stroke={el.stroke ?? '#000000'} strokeWidth={Math.max(el.strokeWidth, 1)} />
      );
      break;
    default:
      shape = <rect width={w} height={h} {...common} />;
  }
  return (
    <svg
      className="absolute inset-0 overflow-visible"
      width={Math.max(w, 1)}
      height={Math.max(h, 1)}
      viewBox={`0 0 ${Math.max(w, 1)} ${Math.max(h, 1)}`}
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}

/** Text lines (bullets drawn with a hanging indent); an empty placeholder shows its hint when `hints` is on. */
export function ElementText({ el, theme, hints }: Readonly<{ el: SlideElement; theme: Theme; hints: boolean }>) {
  const empty = !el.text;
  if (empty && !(hints && el.placeholder)) return null;
  const lines = empty && el.placeholder ? [PLACEHOLDER_HINTS[el.placeholder]] : el.text.split('\n');
  const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[el.style.valign];
  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden break-words whitespace-pre-wrap"
      style={{ ...textBoxStyle(el, theme), justifyContent: justify, opacity: empty ? 0.5 : 1 }}
    >
      {lines.map((line, i) =>
        el.style.bullets ? (
          // Index keys: lines have no identity of their own, and the list is redrawn as a whole.
          <div key={i} className="flex gap-[0.45em]">
            <span aria-hidden="true">•</span>
            <span className="min-w-0 flex-1">{line || '​'}</span>
          </div>
        ) : (
          <div key={i}>{line || '​'}</div>
        )
      )}
    </div>
  );
}

export function ElementView({
  el,
  theme,
  hints = false,
  hideText = false,
}: Readonly<{ el: SlideElement; theme: Theme; hints?: boolean; hideText?: boolean }>) {
  return (
    <div
      className="absolute"
      style={{
        left: el.x,
        top: el.y,
        width: el.w,
        height: el.h,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
    >
      {el.kind === 'image' && el.src ? (
        // Inline data: pictures drawn at slide scale; next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={el.src} alt="" draggable={false} className="pointer-events-none size-full object-fill select-none" />
      ) : null}
      {el.kind === 'shape' && <ShapeGraphic el={el} />}
      {el.kind === 'text' && (el.fill || el.stroke) && (
        <div
          className="absolute inset-0"
          style={{
            background: el.fill ?? undefined,
            border: el.stroke ? `${Math.max(el.strokeWidth, 1)}px solid ${el.stroke}` : undefined,
          }}
        />
      )}
      {el.kind !== 'image' && !hideText && <ElementText el={el} theme={theme} hints={hints} />}
    </div>
  );
}

/** A whole slide at `scale` (1 = 960 × 540 px). */
export function SlideView({
  slide,
  theme,
  scale,
  hints = false,
  className,
}: Readonly<{ slide: Slide; theme: Theme; scale: number; hints?: boolean; className?: string }>) {
  return (
    <div
      className={className}
      style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale, overflow: 'hidden', position: 'relative' }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: SLIDE_WIDTH,
          height: SLIDE_HEIGHT,
          transform: `scale(${scale})`,
          background: slide.background ?? theme.background,
        }}
      >
        {slide.elements.map((el) => (
          <ElementView key={el.id} el={el} theme={theme} hints={hints} />
        ))}
      </div>
    </div>
  );
}
