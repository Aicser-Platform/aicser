import { describe, expect, it } from 'vitest';
import { describeRule, ruleSentence } from '../_components/accessSentence';

const rule = (over: Record<string, unknown> = {}) =>
  ({
    table_name: 'fact_orders',
    column_name: 'customer_id',
    operator: 'eq',
    value_type: 'user_attribute',
    value: 'email',
    ...over,
  }) as Parameters<typeof describeRule>[0];

describe('describeRule', () => {
  it('names the scope in the reader’s terms, not the schema’s', () => {
    expect(describeRule(rule())).toMatchObject({
      target: 'fact_orders.customer_id',
      verb: 'matches',
      scope: 'their own email',
      complete: true,
    });
  });

  it('reads a project attribute as belonging to the project', () => {
    expect(describeRule(rule({ value_type: 'project_attribute', value: 'customer_id' })).scope).toBe(
      "their project's customer_id"
    );
  });

  it('reads an org attribute as belonging to the organization', () => {
    expect(describeRule(rule({ value_type: 'org_attribute', value: 'region' })).scope).toBe(
      "their organization's region"
    );
  });

  it('quotes a fixed value so it reads as a literal, not an attribute', () => {
    expect(describeRule(rule({ value_type: 'fixed', value: 'APAC' })).scope).toBe('“APAC”');
  });

  it('lists a set for in/not_in', () => {
    expect(describeRule(rule({ operator: 'in', value_type: 'fixed', value: ['APAC', 'EMEA'] }))).toMatchObject({
      verb: 'is any of',
      scope: '“APAC”, “EMEA”',
    });
    expect(describeRule(rule({ operator: 'not_in', value_type: 'fixed', value: ['APAC'] })).verb).toBe('is none of');
  });

  it('drops the scope entirely for emptiness checks', () => {
    expect(describeRule(rule({ operator: 'is_null' }))).toMatchObject({ verb: 'is empty', scope: '' });
    expect(describeRule(rule({ operator: 'is_not_null' })).verb).toBe('is not empty');
  });

  it('marks a half-built rule incomplete rather than printing a broken sentence', () => {
    expect(describeRule(rule({ column_name: '' })).complete).toBe(false);
    expect(describeRule(rule({ value: '' })).complete).toBe(false);
    // an emptiness check needs no value, so it is complete without one
    expect(describeRule(rule({ operator: 'is_null', value: '' })).complete).toBe(true);
  });
});

describe('ruleSentence', () => {
  it('renders one readable line', () => {
    expect(ruleSentence(rule())).toBe('Show rows where fact_orders.customer_id matches their own email');
  });

  it('says nothing at all when the rule is not finished', () => {
    expect(ruleSentence(rule({ table_name: '' }))).toBe('');
  });
});
