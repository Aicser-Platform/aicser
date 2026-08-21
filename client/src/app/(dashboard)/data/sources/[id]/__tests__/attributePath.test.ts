import { describe, expect, it } from 'vitest';
import { attributePathFor, unresolvedForRule } from '../_components/accessSentence';

const rule = (over: Record<string, unknown> = {}) =>
  ({
    table_name: 'fact_orders',
    column_name: 'customer_id',
    operator: 'eq',
    value_type: 'project_attribute',
    value: 'customer_id',
    ...over,
  }) as Parameters<typeof attributePathFor>[0];

describe('attributePathFor', () => {
  it('builds the path the engine reports as unresolved', () => {
    expect(attributePathFor(rule())).toBe('project.customer_id');
    expect(attributePathFor(rule({ value_type: 'user_attribute', value: 'email' }))).toBe('user.email');
    expect(attributePathFor(rule({ value_type: 'org_attribute', value: 'region' }))).toBe('org.region');
    expect(attributePathFor(rule({ value_type: 'group_attribute', value: 'team' }))).toBe('group.team');
  });

  it('has no path for a fixed literal', () => {
    expect(attributePathFor(rule({ value_type: 'fixed', value: 'APAC' }))).toBe('');
  });

  it('has no path until an attribute is chosen', () => {
    expect(attributePathFor(rule({ value: '' }))).toBe('');
  });
});

describe('unresolvedForRule', () => {
  const unresolved = ['project.customer_id', 'user.project_id'];

  it('attaches a warning to the rule that caused it', () => {
    expect(unresolvedForRule(rule(), unresolved)).toBe('project.customer_id');
  });

  it('leaves unrelated rules clean', () => {
    expect(unresolvedForRule(rule({ value: 'region' }), unresolved)).toBe('');
    expect(unresolvedForRule(rule({ value_type: 'fixed', value: 'APAC' }), unresolved)).toBe('');
  });

  it('matches regardless of surrounding whitespace', () => {
    expect(unresolvedForRule(rule({ value: '  customer_id  ' }), unresolved)).toBe('project.customer_id');
  });

  it('returns nothing when the engine reported no problems', () => {
    expect(unresolvedForRule(rule(), [])).toBe('');
  });
});
