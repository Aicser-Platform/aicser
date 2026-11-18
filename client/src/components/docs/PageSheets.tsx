'use client';

import { pageBands, pageNumberText, showsBands, SLOTS, type Band } from '@/lib/docs/pageElements';
import type { PageSetup } from '@/lib/docs/model';
import { cn } from '@/lib/ui/utils';

/**
 * The sheets of paper behind the document's one editor, with the header and footer drawn in each sheet's top and
 * bottom margin (page numbers per sheet). Decoration only: the text stays in the editor laid over them.
 */
export function PageSheets({
  page,
  pages,
  stride,
  pageHeight,
  margin,
}: Readonly<{ page: PageSetup; pages: number; stride: number; pageHeight: number; margin: number }>) {
  const { header, footer } = pageBands(page);
  return (
    <>
      {Array.from({ length: pages }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          data-testid="doc-sheet"
          className="absolute inset-x-0 bg-white shadow-md"
          style={{ top: i * stride, height: pageHeight }}
        >
          {showsBands(page, i) && header && (
            <BandRow band={header} index={i} pages={pages} margin={margin} className="top-0" />
          )}
          {showsBands(page, i) && footer && (
            <BandRow band={footer} index={i} pages={pages} margin={margin} className="bottom-0" />
          )}
        </div>
      ))}
    </>
  );
}

function BandRow({
  band,
  index,
  pages,
  margin,
  className,
}: Readonly<{ band: Band; index: number; pages: number; margin: number; className: string }>) {
  return (
    <div
      data-testid="doc-band"
      className={cn('absolute inset-x-0 grid grid-cols-1 items-center text-[10pt] text-neutral-600', className)}
      // The band sits in the middle of the margin, inside the text's left and right edges.
      style={{ height: margin, paddingLeft: margin, paddingRight: margin }}
    >
      {/* The three slots share one cell (as Word's tab stops share a line): a long left text may run under the
          centre, as it would in Word. */}
      {SLOTS.filter((slot) => band[slot].length > 0).map((slot) => (
        <span
          key={slot}
          className={cn(
            'col-start-1 row-start-1 min-w-0 truncate whitespace-pre',
            slot === 'center' && 'text-center',
            slot === 'right' && 'text-right'
          )}
        >
          {band[slot]
            .map((item) => (item.kind === 'text' ? item.text : pageNumberText(item.style, index + 1, pages)))
            .join('   ')}
        </span>
      ))}
    </div>
  );
}
