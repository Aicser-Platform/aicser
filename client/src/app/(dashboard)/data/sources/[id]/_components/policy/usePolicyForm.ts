import { useCallback, useMemo, useRef, useState } from 'react';

import type { DataSourceRLSPolicy, DataSourceRLSPolicyRequest } from '@/api/dataSources';
import {
  useCreateDataSourceRLSPolicy,
  useUpdateDataSourceRLSPolicy,
} from '@/hooks/useDataSources';
import { EMPTY_RULE, buildRulePayload, type RuleFormValue } from './policyForm';

export type PolicyFormState = {
  name: string;
  description: string;
  enabled: boolean;
  defaultDeny: boolean;
  settings: Record<string, unknown>;
  rules: RuleFormValue[];
};

const seed = (policy: DataSourceRLSPolicy | null): PolicyFormState => ({
  name: policy?.name ?? '',
  description: policy?.description ?? '',
  enabled: policy?.enabled ?? true,
  defaultDeny: policy?.default_deny ?? true,
  settings: policy?.settings ?? {},
  rules: policy?.rules?.length
    ? policy.rules.map((rule) => ({
        table_name: rule.table_name,
        column_name: rule.column_name,
        operator: rule.operator,
        value_type: rule.value_type,
        // rule.value is `unknown` on the wire — in/not_in/between store arrays,
        // everything else is scalar-ish. Coerce the same way the existing modal
        // does so those rules round-trip instead of rendering "[object Object]".
        value: Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value ?? ''),
        sort_order: rule.sort_order,
      }))
    : [{ ...EMPTY_RULE }],
});

export const usePolicyForm = ({
  dataSourceId,
  policy,
}: {
  dataSourceId: string;
  policy: DataSourceRLSPolicy | null;
}) => {
  // The baseline is what was last persisted. Comparing against it is what makes
  // the navigation guard trustworthy — a guard that fires on an untouched form
  // gets dismissed reflexively and stops protecting anything.
  const baseline = useRef<PolicyFormState>(seed(policy));
  const [state, setState] = useState<PolicyFormState>(baseline.current);

  const createPolicy = useCreateDataSourceRLSPolicy();
  const updatePolicy = useUpdateDataSourceRLSPolicy();

  const isDirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(baseline.current),
    [state]
  );

  const setField = useCallback(
    <K extends keyof PolicyFormState>(key: K, value: PolicyFormState[K]) => {
      setState((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const updateRule = useCallback((index: number, rule: RuleFormValue) => {
    setState((current) => ({
      ...current,
      rules: current.rules.map((existing, position) => (position === index ? rule : existing)),
    }));
  }, []);

  const addRule = useCallback(() => {
    setState((current) => ({ ...current, rules: [...current.rules, { ...EMPTY_RULE }] }));
  }, []);

  const removeRule = useCallback((index: number) => {
    setState((current) => ({
      ...current,
      rules: current.rules.filter((_, position) => position !== index),
    }));
  }, []);

  const save = useCallback(async () => {
    const payload: DataSourceRLSPolicyRequest = {
      name: state.name.trim(),
      description: state.description.trim() || undefined,
      enabled: state.enabled,
      default_deny: state.defaultDeny,
      settings: state.settings,
      rules: state.rules.map(buildRulePayload),
    };

    if (policy) {
      await updatePolicy.mutateAsync({ id: dataSourceId, policyId: policy.id, data: payload });
    } else {
      await createPolicy.mutateAsync({ id: dataSourceId, data: payload });
    }

    // Only after the server accepted it — resetting on an optimistic call would
    // drop the guard while the edits are still unsaved. Assign a fresh object
    // (rather than reusing `state` by reference) so React doesn't bail out of
    // re-rendering — a same-reference setState would leave `isDirty` stuck at
    // its last memoized value instead of recomputing to false.
    const settled = { ...state };
    baseline.current = settled;
    setState(settled);
  }, [createPolicy, dataSourceId, policy, state, updatePolicy]);

  return {
    state,
    isDirty,
    isSaving: createPolicy.isPending || updatePolicy.isPending,
    setField,
    updateRule,
    addRule,
    removeRule,
    save,
  };
};

export default usePolicyForm;
