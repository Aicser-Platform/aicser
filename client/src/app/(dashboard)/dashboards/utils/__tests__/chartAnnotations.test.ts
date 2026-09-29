import { describe, expect, it } from 'vitest';
import { chartDescription, chartSource, sourcePatch } from '../chartAnnotations';
import { composeChartSvg, exportBands } from '../../services/exportChartImageService';

describe('chart annotations', () => {
  it('reads one source line, falling back to an old brand footer', () => {
    expect(chartSource({ sourceNote: ' Finance ledger ' })).toBe('Finance ledger');
    expect(chartSource({ design: { brand: { footer: 'Acme · 2024' } } })).toBe('Acme · 2024');
    expect(chartSource({ sourceNote: 'Ledger', design: { brand: { footer: 'Acme' } } })).toBe('Ledger');
    expect(chartDescription({ subtitle: 'Monthly totals' })).toBe('Monthly totals');
  });

  it('writing the source retires the brand footer, so there is never a second footer', () => {
    const next = sourcePatch({ design: { brand: { footer: 'Acme', logo: 'x' }, theme: 'a' } }, 'Ledger');
    expect(next.sourceNote).toBe('Ledger');
    expect(next.design).toEqual({ brand: { logo: 'x' }, theme: 'a' });
    expect(chartSource(next)).toBe('Ledger');
  });
});

describe('chart image export', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect/></svg>';

  it('adds bands only for the words the chart has', () => {
    expect(exportBands({})).toEqual({ header: 48, footer: 0 });
    expect(exportBands({ description: 'd', source: 's' })).toEqual({ header: 68, footer: 28 });
  });

  it('puts the description under the title and the source under the chart', () => {
    const out = composeChartSvg(svg, 'Sales <2024>', { description: 'By month', source: 'Ledger & co' });
    expect(out).toContain('Sales &lt;2024&gt;');
    expect(out).toContain('By month');
    expect(out).toContain('Ledger &amp; co');
    expect(out).toContain('height="396"');
    expect(out.indexOf('By month')).toBeLessThan(out.indexOf('<rect/>'));
    expect(out.indexOf('Ledger')).toBeGreaterThan(out.indexOf('<rect/>'));
  });
});
