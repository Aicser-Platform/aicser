import type { ComputedMetric, ComputedMetricSide } from '@/app/(dashboard)/dashboards/Properties/PropertiesPanelConfig';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(field: string): string {
  if (IDENT.test(field)) return `"${field}"`;
  return '';
}

function sideSql(side: ComputedMetricSide): string | null {
  if (!side?.field || !quoteIdent(side.field)) return null;
  const col = quoteIdent(side.field);
  const agg = (side.aggregation || 'sum').toLowerCase();
  if (agg === 'count' || agg === 'distinct_count') {
    return agg === 'distinct_count' ? `COUNT(DISTINCT ${col})` : `COUNT(${col})`;
  }
  const fn = { sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX' }[agg] ?? 'SUM';
  return `${fn}(${col})`;
}

/** SQL expression for a dashboard fx metric (matches chart engine semantics). */
export function computedMetricToExpression(computed: ComputedMetric): string | null {
  const num = sideSql(computed.numerator);
  const den = sideSql(computed.denominator);
  if (!num || !den) return null;
  const mult = computed.multiplier === 100 ? 100 : 1;
  let expr: string;
  switch (computed.type) {
    case 'ratio':
      expr = `${num} * 1.0 / NULLIF(${den}, 0)`;
      break;
    case 'change':
      expr = `((${num}) - (${den})) * 1.0 / NULLIF(${den}, 0)`;
      break;
    case 'difference':
      expr = `(${num}) - (${den})`;
      break;
    case 'sum':
      expr = `(${num}) + (${den})`;
      break;
    case 'product':
      expr = `(${num}) * (${den})`;
      break;
    default:
      return null;
  }
  if (mult !== 1 && (computed.type === 'ratio' || computed.type === 'change')) {
    expr = `${expr} * ${mult}`;
  }
  return expr;
}
