import type {
  DataSourceCLSAction,
  DataSourceCLSMaskStrategy,
  DataSourceCLSRuleRequest,
} from '@/api/dataSources';
import type { SchemaInfo } from '@/stores/useDataSourceStore';
import { columnOptionsFor, tableOptionsFor } from './policyForm';

export const CLS_ACTIONS: DataSourceCLSAction[] = ['mask', 'deny'];
export const CLS_MASK_STRATEGIES: DataSourceCLSMaskStrategy[] = ['fixed', 'partial', 'hash', 'null'];
export const CLS_DRAFT_SESSION_PREFIX = 'cls-policy-draft:';

export type ColumnRuleFormValue = {
  table_name: string;
  column_name: string;
  action: DataSourceCLSAction;
  mask_strategy: DataSourceCLSMaskStrategy | null;
  keep?: string;
  sort_order?: number;
};

export const EMPTY_COLUMN_RULE: ColumnRuleFormValue = {
  table_name: '',
  column_name: '',
  action: 'mask',
  mask_strategy: 'fixed',
  keep: '4',
  sort_order: 0,
};

export const columnTableOptionsFor = (schema: SchemaInfo | null) => tableOptionsFor(schema);

export const columnColumnOptionsFor = (schema: SchemaInfo | null, tableName: string) =>
  columnOptionsFor(schema, tableName);

const positiveKeep = (value?: string): number => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
};

export const buildColumnRulePayload = (rule: ColumnRuleFormValue): DataSourceCLSRuleRequest => {
  const action = rule.action ?? 'mask';
  const maskStrategy = action === 'mask' ? rule.mask_strategy ?? 'fixed' : null;
  const maskConfig: Record<string, unknown> = {};
  if (maskStrategy === 'partial') {
    maskConfig.keep = positiveKeep(rule.keep);
  }

  return {
    table_name: rule.table_name.trim(),
    column_name: rule.column_name.trim(),
    action,
    mask_strategy: maskStrategy,
    mask_config: maskConfig,
    sort_order: Number(rule.sort_order ?? 0),
  };
};

export const seedColumnRule = (rule: DataSourceCLSRuleRequest): ColumnRuleFormValue => ({
  table_name: rule.table_name,
  column_name: rule.column_name,
  action: rule.action,
  mask_strategy: rule.action === 'mask' ? rule.mask_strategy ?? 'fixed' : null,
  keep:
    rule.mask_strategy === 'partial' && typeof rule.mask_config?.keep === 'number'
      ? String(rule.mask_config.keep)
      : '4',
  sort_order: rule.sort_order ?? 0,
});
