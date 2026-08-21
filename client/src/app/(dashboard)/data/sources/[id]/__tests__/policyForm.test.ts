import { describe, expect, it } from 'vitest';
import type { SchemaInfo } from '@/stores/useDataSourceStore';
import {
  EMPTY_RULE,
  attributeKeyOptions,
  buildRulePayload,
  columnOptionsFor,
  tableOptionsFor,
} from '../_components/policy/policyForm';

const schema = {
  tables: [
    { name: 'fact_orders', columns: [{ name: 'customer_id', type: 'int' }, { name: 'region', type: 'varchar' }] },
    { name: 'dim_customer', columns: [{ name: 'customer_name', type: 'varchar' }] },
  ],
  schemas: [],
} as unknown as SchemaInfo;

describe('schema-driven options', () => {
  it('lists every table', () => {
    expect(tableOptionsFor(schema).map((option) => option.value)).toEqual(['fact_orders', 'dim_customer']);
  });

  it('scopes columns to the selected table and shows the type', () => {
    expect(columnOptionsFor(schema, 'fact_orders')).toEqual([
      { value: 'customer_id', label: 'customer_id · int' },
      { value: 'region', label: 'region · varchar' },
    ]);
  });

  it('returns nothing for an unknown table rather than leaking another table’s columns', () => {
    expect(columnOptionsFor(schema, 'missing')).toEqual([]);
  });

  it('returns nothing when the schema failed to load', () => {
    expect(tableOptionsFor(null)).toEqual([]);
    expect(columnOptionsFor(null, 'fact_orders')).toEqual([]);
  });
});

describe('buildRulePayload', () => {
  it('omits the value entirely for null-checks', () => {
    const payload = buildRulePayload({
      table_name: 'fact_orders',
      column_name: 'region',
      operator: 'is_null',
      value_type: 'fixed',
      value: 'ignored',
      sort_order: 0,
    });
    expect(payload.value).toBeNull();
  });

  it('splits comma lists for in/not_in/between on fixed values', () => {
    expect(
      buildRulePayload({
        table_name: 'fact_orders',
        column_name: 'region',
        operator: 'in',
        value_type: 'fixed',
        value: 'APAC, EMEA ,NA',
        sort_order: 0,
      }).value
    ).toEqual(['APAC', 'EMEA', 'NA']);
  });

  it('keeps an attribute path as an unsplit string', () => {
    expect(
      buildRulePayload({
        table_name: 'fact_orders',
        column_name: 'customer_id',
        operator: 'eq',
        value_type: 'user_attribute',
        value: ' settings.region ',
        sort_order: 0,
      }).value
    ).toBe('settings.region');
  });

  it('trims identifiers', () => {
    const payload = buildRulePayload({
      table_name: ' fact_orders ',
      column_name: ' region ',
      operator: 'eq',
      value_type: 'fixed',
      value: 'APAC',
      sort_order: 2,
    });
    expect(payload.table_name).toBe('fact_orders');
    expect(payload.column_name).toBe('region');
    expect(payload.sort_order).toBe(2);
  });
});

describe('attribute key options', () => {
  it('offers the identity attributes the backend actually resolves', () => {
    const keys = attributeKeyOptions('user_attribute').map((option) => option.value);
    expect(keys).toContain('email');
    expect(keys).toContain('username');
    expect(keys).toContain('tenant_id');
    expect(keys).toContain('company');
  });

  it('offers only project keys that actually exist, never invented ones', () => {
    // project.name was offered before and did not resolve — the list must come
    // from the attributes endpoint, so an empty scope offers nothing.
    expect(attributeKeyOptions('project_attribute')).toEqual([]);
    expect(attributeKeyOptions('project_attribute', ['customer_id', 'region'])).toEqual([
      { value: 'customer_id', label: 'customer_id' },
      { value: 'region', label: 'region' },
    ]);
  });

  it('ignores scoped keys for user attributes, which are fixed by the backend', () => {
    const keys = attributeKeyOptions('user_attribute', ['made_up']).map((o) => o.value);
    expect(keys).toContain('email');
    expect(keys).not.toContain('made_up');
  });

  it('offers nothing for fixed literals — there is no key to pick', () => {
    expect(attributeKeyOptions('fixed')).toEqual([]);
  });
});

describe('EMPTY_RULE', () => {
  it('starts a new rule on the viewer’s email, the identity clients actually use', () => {
    expect(EMPTY_RULE.value_type).toBe('user_attribute');
    expect(EMPTY_RULE.value).toBe('email');
  });
});
