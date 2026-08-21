import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DataSourceRLSPolicy } from '@/api/dataSources';
import { EMPTY_RULE } from '../_components/policy/policyForm';
import { usePolicyForm } from '../_components/policy/usePolicyForm';

vi.mock('@/hooks/useDataSources', () => ({
  useCreateDataSourceRLSPolicy: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useUpdateDataSourceRLSPolicy: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));

describe('usePolicyForm', () => {
  it('starts clean and becomes dirty on the first edit', () => {
    const { result } = renderHook(() => usePolicyForm({ dataSourceId: 'ds-1', policy: null }));
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setField('name', 'Customer ID'));
    expect(result.current.isDirty).toBe(true);
  });

  it('seeds state from an existing policy', () => {
    const policy = {
      id: 'p1', name: 'Customer ID', description: 'Limit to assigned customer',
      enabled: true, default_deny: true,
      rules: [{ id: 'r1', table_name: 'fact_orders', column_name: 'customer_id',
                operator: 'eq', value_type: 'project_attribute', value: 'customer_id' }],
    } as unknown as DataSourceRLSPolicy;

    const { result } = renderHook(() => usePolicyForm({ dataSourceId: 'ds-1', policy }));

    expect(result.current.state.name).toBe('Customer ID');
    expect(result.current.state.rules).toHaveLength(1);
    expect(result.current.isDirty).toBe(false);
  });

  it('reverts to clean after a successful save', async () => {
    const { result } = renderHook(() => usePolicyForm({ dataSourceId: 'ds-1', policy: null }));
    act(() => result.current.setField('name', 'Customer ID'));

    await act(async () => { await result.current.save(); });

    expect(result.current.isDirty).toBe(false);
  });

  it('removes the right rule', () => {
    const { result } = renderHook(() => usePolicyForm({ dataSourceId: 'ds-1', policy: null }));
    // Seeds one blank rule, matching the modal this page replaces.
    expect(result.current.state.rules).toHaveLength(1);

    act(() => { result.current.addRule(); result.current.addRule(); });
    act(() => result.current.updateRule(1, { ...EMPTY_RULE, table_name: 'dim_product' }));
    act(() => result.current.removeRule(0));

    expect(result.current.state.rules).toHaveLength(2);
    expect(result.current.state.rules[0].table_name).toBe('dim_product');
  });
});
