import { FOOTER_BOXES, FOOTER_FONT_PT, type FooterContent } from '@/lib/slides/footer';
import { PX_PER_PT, type Theme } from '@/lib/slides/model';

/** The footer row drawn over a slide (canvas px; the slide's own scale applies). Not selectable or editable. */
export function SlideFooterLayer({ content, theme }: Readonly<{ content: FooterContent; theme: Theme }>) {
  return (
    <div aria-hidden="true" data-testid="slide-footer" className="pointer-events-none absolute inset-0 select-none">
      {(['date', 'text', 'number'] as const).map((key) => {
        const value = content[key];
        if (!value) return null;
        const box = FOOTER_BOXES[key];
        return (
          <div
            key={key}
            className="absolute flex items-center truncate whitespace-pre"
            style={{
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
              justifyContent: box.align === 'left' ? 'flex-start' : box.align === 'right' ? 'flex-end' : 'center',
              fontFamily: theme.bodyFont,
              fontSize: FOOTER_FONT_PT * PX_PER_PT,
              color: theme.text,
              opacity: 0.7,
            }}
          >
            {value}
          </div>
        );
      })}
    </div>
  );
}
