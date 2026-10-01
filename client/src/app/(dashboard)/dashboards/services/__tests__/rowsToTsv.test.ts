import { describe, expect, it } from 'vitest';
import { rowsToTsv } from '../exportChartDataService';

describe('copy data', () => {
  it('pastes into a spreadsheet as columns', () => {
    expect(rowsToTsv([{ month: 'Jan', total: 10 }, { month: 'Feb\tx', total: null }])).toBe('month\ttotal\nJan\t10\nFeb x\t');
  });
});
