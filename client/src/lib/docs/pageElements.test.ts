import { describe, expect, it } from 'vitest';
import type { PageSetup } from './model';
import { hasPageElements, pageBands, pageNumberText, showsBands } from './pageElements';

const base: PageSetup = { size: 'a4', margins: 'normal', orientation: 'portrait' };

describe('page elements', () => {
  it('has none for an older document', () => {
    expect(pageBands(base)).toEqual({ header: null, footer: null });
    expect(hasPageElements(base)).toBe(false);
    expect(hasPageElements({ ...base, header: '   ', pageNumbers: 'none' })).toBe(false);
  });

  it('puts text and numbers in their slots', () => {
    const { header, footer } = pageBands({
      ...base,
      header: ' Report ',
      headerAlign: 'center',
      footer: 'Draft',
      pageNumbers: 'footer',
      pageNumberAlign: 'left',
    });
    expect(header?.center).toEqual([{ kind: 'text', text: 'Report' }]);
    expect(footer?.left).toEqual([
      { kind: 'text', text: 'Draft' },
      { kind: 'number', style: 'number' },
    ]);
  });

  it('numbers alone default to the right of the footer', () => {
    const { header, footer } = pageBands({ ...base, pageNumbers: 'footer' });
    expect(header).toBeNull();
    expect(footer?.right).toEqual([{ kind: 'number', style: 'number' }]);
  });

  it('formats numbers and skips the first page when asked', () => {
    expect(pageNumberText('number', 3, 7)).toBe('3');
    expect(pageNumberText('pageOf', 3, 7)).toBe('Page 3 of 7');
    expect(showsBands({ ...base, differentFirstPage: true }, 0)).toBe(false);
    expect(showsBands({ ...base, differentFirstPage: true }, 1)).toBe(true);
    expect(showsBands(base, 0)).toBe(true);
  });
});
