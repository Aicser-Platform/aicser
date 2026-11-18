import type { PageSetup } from './model';

// Header, footer and page numbers of a Docs document: one line at the top and bottom of every page, each with
// up to three slots (left, centre, right) like Word's header tab stops. Shared by the editor's pages and .docx.

export type SlotAlign = 'left' | 'center' | 'right';
export const SLOTS: readonly SlotAlign[] = ['left', 'center', 'right'];

/** One piece of a band: plain text, or the page number (drawn per page, a field in Word). */
export type BandItem = { kind: 'text'; text: string } | { kind: 'number'; style: 'number' | 'pageOf' };
export type Band = Record<SlotAlign, BandItem[]>;

const emptyBand = (): Band => ({ left: [], center: [], right: [] });

/** The header and footer bands of a page setup; null when the band is empty. */
export function pageBands(page: PageSetup): { header: Band | null; footer: Band | null } {
  const header = emptyBand();
  const footer = emptyBand();
  const headerText = page.header?.trim();
  const footerText = page.footer?.trim();
  if (headerText) header[page.headerAlign ?? 'left'].push({ kind: 'text', text: headerText });
  if (footerText) footer[page.footerAlign ?? 'left'].push({ kind: 'text', text: footerText });
  const numbers = page.pageNumbers ?? 'none';
  if (numbers !== 'none') {
    const band = numbers === 'header' ? header : footer;
    band[page.pageNumberAlign ?? 'right'].push({ kind: 'number', style: page.pageNumberStyle ?? 'number' });
  }
  const used = (band: Band) => SLOTS.some((slot) => band[slot].length > 0);
  return { header: used(header) ? header : null, footer: used(footer) ? footer : null };
}

/** The text of a page number: "3" or "Page 3 of 7". */
export function pageNumberText(style: 'number' | 'pageOf', page: number, pages: number): string {
  return style === 'pageOf' ? `Page ${page} of ${pages}` : String(page);
}

/** Whether a page (0-based) shows the bands. */
export const showsBands = (page: PageSetup, index: number) => !(page.differentFirstPage && index === 0);

/** True when the setup has any page element at all. */
export function hasPageElements(page: PageSetup): boolean {
  const { header, footer } = pageBands(page);
  return header !== null || footer !== null;
}
