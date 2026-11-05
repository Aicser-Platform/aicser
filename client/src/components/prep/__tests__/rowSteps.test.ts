import { describe, expect, it } from 'vitest';
import { buildStep, formForStep, headerNames } from '../StepForm';
import { stepSentence } from '../stepText';

const t = (key: string, values?: Record<string, unknown>) => `${key}${values ? JSON.stringify(values) : ''}`;

describe('messy-sheet headers', () => {
  it('joins several header rows into one name per column', () => {
    const rows = [{ a: 'Sales', b: 'Sales', c: '' }, { a: '2025', b: '2026', c: 'Region' }];
    expect(headerNames(rows, ['a', 'b', 'c'], ' ')).toEqual({ a: 'Sales 2025', b: 'Sales 2026', c: 'Region' });
  });

  it('keeps the column name when the header cell is empty and never repeats a name', () => {
    expect(headerNames([{ a: 'Total', b: 'total', c: null }], ['a', 'b', 'c'], ' ')).toEqual({ a: 'Total', b: 'total 2', c: 'c' });
  });

  it('builds the step from rows above, header rows and names', () => {
    expect(buildStep('header_rows', { skip: 2, rows: 2, names: { a: 'Sales 2025' } }, ['a'])).toEqual({
      header_rows: { skip: 2, rows: 2, names: { a: 'Sales 2025' } },
    });
    expect(buildStep('header_rows', { skip: 0, rows: 1, names: {} }, ['a'])).toBeNull();
  });

  it('removes any number of top and bottom rows, and nothing is not a step', () => {
    expect(buildStep('remove_rows', { top: 3, bottom: 0 }, [])).toEqual({ remove_rows: { top: 3 } });
    expect(buildStep('remove_rows', { top: 0, bottom: 2 }, [])).toEqual({ remove_rows: { bottom: 2 } });
    expect(buildStep('remove_rows', { top: 0, bottom: 0 }, [])).toBeNull();
  });
});

describe('row steps', () => {
  it('splits one column into rows, and expands several list columns together', () => {
    expect(buildStep('split_rows', { column: 'tags', format: 'text', delimiter: ';' }, [])).toEqual({
      explode: { columns: ['tags'], json: false, delimiter: ';' },
    });
    expect(buildStep('expand_rows', { columns: ['items', 'qty'], format: 'json' }, [])).toEqual({
      explode: { columns: ['items', 'qty'], json: true },
    });
    expect(formForStep({ explode: { columns: ['tags'] } })).toBe('expand_rows');
  });

  it('needs an order for calculations that run down the rows', () => {
    expect(buildStep('window', { calc: 'running_total', column: 'amount' }, [])).toBeNull();
    expect(buildStep('window', { calc: 'running_total', column: 'amount', orderBy: 'date', into: '' }, [])).toEqual({
      window: { calc: 'running_total', column: 'amount', into: 'running_total_amount', order_by: 'date' },
    });
    expect(buildStep('window', { calc: 'percent_of_total', column: 'amount', into: 'share', partitionBy: ['region'] }, [])).toEqual({
      window: { calc: 'percent_of_total', column: 'amount', into: 'share', partition_by: ['region'] },
    });
  });

  it('groups numbers at boundaries or into equal ranges', () => {
    expect(buildStep('bin', { column: 'amount', into: 'band', mode: 'edges', edges: '10000, 50000', labels: 'Small, Medium, Large' }, [])).toEqual({
      bin: { column: 'amount', into: 'band', mode: 'edges', edges: [10000, 50000], labels: ['Small', 'Medium', 'Large'] },
    });
    expect(buildStep('bin', { column: 'amount', into: 'band', mode: 'quantiles', count: 5 }, [])).toEqual({
      bin: { column: 'amount', into: 'band', mode: 'quantiles', count: 5 },
    });
  });

  it('keeps top N per group, and matches similar text when asked', () => {
    expect(buildStep('top_n', { n: 3, orderBy: 'sales', descending: true, partitionBy: ['region'] }, [])).toEqual({
      top_n: { n: 3, order_by: 'sales', descending: true, partition_by: ['region'] },
    });
    expect(buildStep('merge', { asset: 'x', how: 'left', pairs: [['name', 'company']], match: 'similar', threshold: 0.85 }, [])).toEqual({
      join: { asset: 'x', how: 'left', on: { name: 'company' }, match: 'similar', threshold: 0.85 },
    });
  });

  it('describes the new steps in a sentence', () => {
    expect(stepSentence({ top_n: { n: 3, order_by: 'sales' } }, t as never)).toBe('s_top_n{"n":3,"column":"sales"}');
    expect(stepSentence({ header_rows: { rows: 2, names: {} } }, t as never)).toBe('s_header_rows{"rows":2}');
  });
});
