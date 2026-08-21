import { describe, expect, it } from 'vitest';
import {
  EMPTY_COLUMN_RULE,
  buildColumnRulePayload,
  columnColumnOptionsFor,
  seedColumnRule,
} from '../_components/policy/columnPolicyForm';

const schema = {
  tables: [
    {
      name: 'customers',
      columns: [
        { name: 'email', type: 'varchar', nullable: true },
        { name: 'ssn', type: 'varchar', nullable: true },
      ],
    },
  ],
  schemas: [],
};

describe('columnPolicyForm', () => {
  it('defaults new rules to fixed masking', () => {
    expect(EMPTY_COLUMN_RULE).toMatchObject({
      action: 'mask',
      mask_strategy: 'fixed',
    });
  });

  it('builds a deny payload without a mask strategy', () => {
    expect(
      buildColumnRulePayload({
        table_name: ' customers ',
        column_name: ' ssn ',
        action: 'deny',
        mask_strategy: 'fixed',
      })
    ).toMatchObject({
      table_name: 'customers',
      column_name: 'ssn',
      action: 'deny',
      mask_strategy: null,
      mask_config: {},
    });
  });

  it('builds partial masking config with a positive keep count', () => {
    expect(
      buildColumnRulePayload({
        table_name: 'customers',
        column_name: 'email',
        action: 'mask',
        mask_strategy: 'partial',
        keep: '6',
      }).mask_config
    ).toEqual({ keep: 6 });
  });

  it('scopes column options to the selected table', () => {
    expect(columnColumnOptionsFor(schema, 'customers')).toEqual([
      { value: 'email', label: 'email · varchar' },
      { value: 'ssn', label: 'ssn · varchar' },
    ]);
  });

  it('seeds form state from an existing rule payload', () => {
    expect(
      seedColumnRule({
        table_name: 'customers',
        column_name: 'email',
        action: 'mask',
        mask_strategy: 'partial',
        mask_config: { keep: 3 },
      })
    ).toMatchObject({ mask_strategy: 'partial', keep: '3' });
  });
});
