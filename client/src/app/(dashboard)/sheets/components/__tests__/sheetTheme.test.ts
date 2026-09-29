import { describe, expect, it } from 'vitest';
import { forDarkGrid, parseColor, throughDarkFilter } from '../sheetTheme';

const close = (a: string, b: string, tol = 12) => parseColor(a).slice(0, 3).every((v, i) => Math.abs(v - parseColor(b)[i]) <= tol);

describe('dark grid colours', () => {
  it('turns black text white and white cells dark', () => {
    expect(close(throughDarkFilter('#000000'), '#ffffff')).toBe(true);
    expect(close(throughDarkFilter('#ffffff'), '#000000')).toBe(true);
  });

  it('keeps the hue of style fills while darkening them', () => {
    const [r, g, b] = parseColor(throughDarkFilter('#FFC7CE')); // Excel "Bad" fill
    expect(r).toBeGreaterThan(g);
    expect(r + g + b).toBeLessThan(parseColor('#FFC7CE').slice(0, 3).reduce((x, y) => x + y, 0));
  });

  it('the filter undoes itself, so the grid palette comes out as the app palette', () => {
    for (const c of ['#141414', '#303030', '#ffffff']) expect(close(throughDarkFilter(throughDarkFilter(c)), c, 2)).toBe(true);
    // Saturated accents come back close (the filter clips at the edges of the colour range).
    for (const c of ['rgb(40, 180, 170)', '#1677ff']) expect(close(throughDarkFilter(throughDarkFilter(c)), c, 40)).toBe(true);
    expect(forDarkGrid({ '--palette-common-white': '#141414', '--typography-font-family': 'Inter' })['--typography-font-family']).toBe('Inter');
  });
});

describe('selection fill', () => {
  it('stays translucent in both themes, so selected values show through', async () => {
    const { sheetThemeVariables } = await import('../sheetTheme');
    const token = {
      colorBgContainer: '#ffffff', colorText: '#24292f', colorPrimary: '#007a80', colorTextSecondary: '#57606a',
      colorFillQuaternary: '#f5f5f5', colorBorder: '#8c959f', colorBorderSecondary: '#d0d7de', fontFamily: 'x', fontSizeSM: 12,
    } as never;
    for (const dark of [false, true]) {
      const fill = sheetThemeVariables(token, dark)['--palette-sheet-outline-background-color'];
      const alpha = parseColor(fill)[3];
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(0.3);
      const seen = parseColor(forDarkGrid({ fill }).fill)[3];
      expect(seen).toBe(alpha);
    }
  });
});
