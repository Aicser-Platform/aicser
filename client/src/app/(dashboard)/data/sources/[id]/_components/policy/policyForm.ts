import type { SchemaInfo } from '@/stores/useDataSourceStore';
import type {
  DataSourceRLSOperator,
  DataSourceRLSRuleRequest,
  DataSourceRLSValueType,
} from '@/api/dataSources';

export const RLS_OPERATORS: DataSourceRLSOperator[] = ['eq', 'in', 'not_in', 'between', 'is_null', 'is_not_null'];

export const RLS_VALUE_TYPES: DataSourceRLSValueType[] = [
  'fixed',
  'user_attribute',
  'group_attribute',
  'org_attribute',
  'project_attribute',
];

export type RuleFormValue = {
  table_name: string;
  column_name: string;
  operator: DataSourceRLSOperator;
  value_type: DataSourceRLSValueType;
  value?: string;
  sort_order?: number;
};

const NULL_OPERATORS: DataSourceRLSOperator[] = ['is_null', 'is_not_null'];
const LIST_OPERATORS: DataSourceRLSOperator[] = ['in', 'not_in', 'between'];

export const isNullOperator = (operator: DataSourceRLSOperator) => NULL_OPERATORS.includes(operator);

export const tableOptionsFor = (schema: SchemaInfo | null) =>
  (schema?.tables ?? []).map((table) => ({ value: table.name, label: table.name }));

export const columnOptionsFor = (schema: SchemaInfo | null, tableName: string) => {
  const table = (schema?.tables ?? []).find((item) => item.name === tableName);
  return (table?.columns ?? []).map((column) => ({
    value: column.name,
    label: `${column.name} · ${column.type}`,
  }));
};

export const buildRulePayload = (rule: RuleFormValue): DataSourceRLSRuleRequest => {
  const raw = String(rule.value ?? '').trim();
  let value: unknown;

  if (isNullOperator(rule.operator)) {
    value = null;
  } else if (rule.value_type !== 'fixed') {
    value = raw;
  } else if (!raw) {
    value = null;
  } else if (LIST_OPERATORS.includes(rule.operator)) {
    value = raw.split(',').map((item) => item.trim()).filter(Boolean);
  } else {
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
  }

  return {
    table_name: rule.table_name.trim(),
    column_name: rule.column_name.trim(),
    operator: rule.operator,
    value_type: rule.value_type,
    value,
    sort_order: Number(rule.sort_order ?? 0),
  };
};

/**
 * Keys _load_user_attributes actually populates. The list is an assist, not a
 * gate — the Select stays free-entry so dotted paths (settings.region) work.
 */
const USER_ATTRIBUTE_KEYS = [
  'email',
  'username',
  'first_name',
  'last_name',
  'role',
  'status',
  'tenant_id',
  'company',
  'location',
  'timezone',
  'job_role',
  'industry',
  'organization_id',
  'project_id',
];

/**
 * Project and org attribute keys are whatever has been stored for that scope,
 * so they come from the attributes endpoint rather than a hardcoded guess —
 * offering keys that do not resolve is what produced "Unresolved attribute:
 * project.name". User attributes are fixed by _load_user_attributes.
 */
export const attributeKeyOptions = (
  valueType: DataSourceRLSValueType,
  scopedKeys: string[] = []
) => {
  if (valueType === 'fixed') return [];
  if (valueType === 'user_attribute') {
    return USER_ATTRIBUTE_KEYS.map((value) => ({ value, label: value }));
  }
  return scopedKeys.map((value) => ({ value, label: value }));
};


// Identity clients actually use is the viewer's email, not a synthetic customer id.
export const EMPTY_RULE: RuleFormValue = {
  table_name: '',
  column_name: '',
  operator: 'eq',
  value_type: 'user_attribute',
  value: 'email',
  sort_order: 0,
};
