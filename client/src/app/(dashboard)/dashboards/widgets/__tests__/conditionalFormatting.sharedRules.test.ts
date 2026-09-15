import { describe, expect, it } from 'vitest';
import { getStatValueStyle, getSeriesPointColors } from '../utils/conditionalFormatting';
import type { ConditionalFormattingRule } from '../../Properties/ConditionalFormattingEditor';

function rule(overrides: Partial<ConditionalFormattingRule>): ConditionalFormattingRule {
  return {
    id: 'r1',
    column: 'value',
    operator: 'gt',
    value: '0',
    applyTo: 'cell',
    ...overrides,
  };
}

describe('getStatValueStyle — same rule engine as Table, applied to a single KPI value', () => {
  it('applies the first matching rule (column="value") to the headline number', () => {
    const rules = [rule({ column: 'value', operator: 'gte', value: '100', bgColor: '#ff0000', textColor: '#fff' })];
    expect(getStatValueStyle(rules, 150)).toEqual({ backgroundColor: '#ff0000', color: '#fff' });
  });

  it('does not match when the value fails the rule', () => {
    const rules = [rule({ column: 'value', operator: 'gte', value: '100', textColor: '#f00' })];
    expect(getStatValueStyle(rules, 50)).toEqual({});
  });

  it('honors a wildcard column ("*") the same as "value"', () => {
    const rules = [rule({ column: '*', operator: 'lt', value: '10', textColor: '#faad14' })];
    expect(getStatValueStyle(rules, 5)).toEqual({ color: '#faad14' });
  });

  it('ignores rules targeting a different column than "value"/"*"', () => {
    const rules = [rule({ column: 'revenue', operator: 'gt', value: '0', textColor: '#f00' })];
    expect(getStatValueStyle(rules, 500)).toEqual({});
  });

  it('returns {} when no rules are configured', () => {
    expect(getStatValueStyle(undefined, 500)).toEqual({});
    expect(getStatValueStyle([], 500)).toEqual({});
  });

  it('first match wins, mirroring the table engine', () => {
    const rules = [
      rule({ column: 'value', operator: 'gt', value: '0', textColor: '#green' }),
      rule({ column: 'value', operator: 'gt', value: '100', textColor: '#red' }),
    ];
    expect(getStatValueStyle(rules, 500)).toEqual({ color: '#green' });
  });
});

describe('getSeriesPointColors — same rule engine applied per bar/data point', () => {
  it('colors only the points that breach the rule, leaving others undefined', () => {
    const rules = [rule({ column: 'revenue', operator: 'gt', value: '100', bgColor: '#ff4d4f' })];
    const colors = getSeriesPointColors(rules, 'revenue', [50, 150, 90, 200]);
    expect(colors).toEqual([undefined, '#ff4d4f', undefined, '#ff4d4f']);
  });

  it('matches a wildcard rule against any series name', () => {
    const rules = [rule({ column: '*', operator: 'lt', value: '10', bgColor: '#faad14' })];
    expect(getSeriesPointColors(rules, 'error_count', [5, 20])).toEqual(['#faad14', undefined]);
  });

  it('ignores rules for a different series name', () => {
    const rules = [rule({ column: 'cost', operator: 'gt', value: '0', bgColor: '#f00' })];
    expect(getSeriesPointColors(rules, 'revenue', [500])).toEqual([undefined]);
  });

  it('returns an all-undefined array when no rules are configured', () => {
    expect(getSeriesPointColors(undefined, 'revenue', [1, 2, 3])).toEqual([undefined, undefined, undefined]);
  });
});
