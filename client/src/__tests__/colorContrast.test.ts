import { describe, expect, it } from 'vitest';
import { accessiblePrimary, hexContrast, primaryLinkTokens, statusTintTokens } from '@/utils/colorContrast';

const WHITE = '#ffffff';
const CANVAS = '#f0f2f5';
// Every brand-preset primary (BrandThemeProvider) plus the default teal.
const BRANDS = ['#00c2cb', '#1e40af', '#059669', '#8b5cf6', '#d97706', '#0d9488', '#8a6a00'];

describe('accessiblePrimary (light mode)', () => {
  it.each(BRANDS)('%s: labels on it and it as text on the canvas reach WCAG AA', (brand) => {
    const s = accessiblePrimary(brand, false);
    expect(hexContrast(s.base, s.text)!).toBeGreaterThanOrEqual(4.5);
    expect(hexContrast(s.base, WHITE)!).toBeGreaterThanOrEqual(4.5);
    expect(hexContrast(s.base, CANVAS)!).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BRANDS)('%s: hover and pressed are distinct, darker steps', (brand) => {
    const s = accessiblePrimary(brand, false);
    expect(new Set([s.base, s.hover, s.active]).size).toBe(3);
    expect(hexContrast(s.hover, WHITE)!).toBeGreaterThan(hexContrast(s.base, WHITE)!);
    expect(hexContrast(s.active, WHITE)!).toBeGreaterThan(hexContrast(s.hover, WHITE)!);
  });

  it('leaves an already-readable brand colour unchanged', () => {
    expect(accessiblePrimary('#1e40af', false).base).toBe('#1e40af');
  });
});

describe('accessiblePrimary (dark mode)', () => {
  it('keeps the brand colour and picks a readable label for it', () => {
    const s = accessiblePrimary('#00c2cb', true, '#00a5af', '#008b95');
    expect(s).toEqual({ base: '#00c2cb', hover: '#00a5af', active: '#008b95', text: '#0d1117' });
    expect(hexContrast(s.base, s.text)!).toBeGreaterThanOrEqual(4.5);
  });
});

describe('statusTintTokens', () => {
  it('tints each status colour in light mode and leaves dark mode to the algorithm', () => {
    const light = statusTintTokens(false, { success: '#16a34a', warning: '#f97316', error: '#dc2626', info: '#0891b2' });
    expect(light.colorSuccessBg).toBe('#e8f6ed');
    expect(Object.keys(light)).toHaveLength(24);
    expect(hexContrast(light.colorErrorHover, WHITE)!).toBeGreaterThanOrEqual(4.5);
    expect(statusTintTokens(true, { success: '#16a34a', warning: '#f97316', error: '#dc2626', info: '#0891b2' })).toEqual({});
  });
});

describe('primaryLinkTokens', () => {
  it.each(BRANDS)('%s: links and their hover stay readable in light mode', (brand) => {
    const l = primaryLinkTokens(accessiblePrimary(brand, false), false);
    expect(hexContrast(l.colorLink, WHITE)!).toBeGreaterThanOrEqual(4.5);
    expect(hexContrast(l.colorLinkHover, WHITE)!).toBeGreaterThanOrEqual(4.5);
  });

  it('the default teal link and its hover stay readable in dark mode', () => {
    const l = primaryLinkTokens(accessiblePrimary('#00c2cb', true, '#00a5af', '#008b95'), true);
    expect(hexContrast(l.colorLink, '#0d1117')!).toBeGreaterThanOrEqual(4.5);
    expect(hexContrast(l.colorLinkHover, '#0d1117')!).toBeGreaterThanOrEqual(4.5);
  });
});
