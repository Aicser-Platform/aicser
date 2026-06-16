import { describe, expect, it } from 'vitest';
import { normalizeDashboardFilters } from '@/app/(dashboard)/dashboards/utils/normalizeDashboardFilters';

describe('normalizeDashboardFilters', () => {
  it('converts AI planner descriptors into dashboard UI filters', () => {
    const filters = normalizeDashboardFilters(
      [
        {
          type: 'date_range',
          field: 'disbursement_date',
          label: 'Disbursement Date',
          default: 'last_30_days',
        },
        {
          type: 'select',
          field: 'loan_status',
          label: 'Loan Status',
          multi: true,
        },
        {
          type: 'select',
          field: 'product_type',
          label: 'Product Type',
          multi: false,
        },
      ],
      { dataSourceId: 'source-1', tableName: 'data' }
    );

    expect(filters).toHaveLength(3);
    expect(filters[0]).toMatchObject({
      field: 'disbursement_date',
      name: 'Disbursement Date',
      type: 'dateRange',
      isGlobal: true,
      dataSourceId: 'source-1',
      tableName: 'data',
    });
    expect(filters[0].defaultValue).toEqual(expect.arrayContaining([expect.any(String), expect.any(String)]));
    expect(filters[1]).toMatchObject({ field: 'loan_status', type: 'checkbox' });
    expect(filters[2]).toMatchObject({ field: 'product_type', type: 'dropdown' });
  });

  it('keeps native dashboard filters stable', () => {
    const [filter] = normalizeDashboardFilters([
      {
        id: 'branch',
        name: 'Branch',
        type: 'dropdown',
        field: 'branch_name',
        defaultValue: 'Phnom Penh',
      },
    ]);

    expect(filter).toMatchObject({
      id: 'branch',
      name: 'Branch',
      type: 'dropdown',
      field: 'branch_name',
      defaultValue: 'Phnom Penh',
    });
  });
});
