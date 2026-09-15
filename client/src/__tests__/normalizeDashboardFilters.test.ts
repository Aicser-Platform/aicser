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

  it('binds a filter to the widget that actually references its field, not just the first widget with any dataSourceId', () => {
    // AI-generated multi-table dashboards defaulted every filter's
    // dataSourceId/tableName to whichever widget happened to be first in the
    // store, regardless of whether that widget's table actually has the
    // field - silently mis-binding the filter for every other table.
    const widgets = [
      { dataSourceId: 'ds-customers', chartQuery: { tableName: 'customers', x: 'signup_month' } },
      { dataSourceId: 'ds-sales', chartQuery: { tableName: 'sales', x: 'region', yMetrics: [{ field: 'revenue' }] } },
    ];

    const [filter] = normalizeDashboardFilters(
      [{ type: 'select', field: 'region', label: 'Region' }],
      { dataSourceId: 'ds-customers', tableName: 'customers', widgets },
    );

    expect(filter).toMatchObject({ dataSourceId: 'ds-sales', tableName: 'sales' });
  });

  it('falls back to the flat context when no widget references the filter field', () => {
    const widgets = [{ dataSourceId: 'ds-customers', chartQuery: { tableName: 'customers', x: 'signup_month' } }];

    const [filter] = normalizeDashboardFilters(
      [{ type: 'select', field: 'brand_new_field', label: 'Brand New Field' }],
      { dataSourceId: 'ds-customers', tableName: 'customers', widgets },
    );

    expect(filter).toMatchObject({ dataSourceId: 'ds-customers', tableName: 'customers' });
  });
});
