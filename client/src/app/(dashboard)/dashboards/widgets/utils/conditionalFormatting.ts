import type React from 'react';
import type { ConditionalFormattingRule } from '../../Properties/ConditionalFormattingEditor';

// ─── Conditional Formatting helpers ──────────────────────────────────────────
// Shared between TableWidget (dashboard-native {x,y,series} pivot) and
// RawRowsTableWidget (flat chat-origin rows) so both table renderers apply the
// same rule-matching semantics — only the column-key/row-shape differ.

export function testRule(
  rule: ConditionalFormattingRule,
  value: unknown
): boolean {
  const numVal = typeof value === 'number' ? value : parseFloat(String(value));
  const ruleNum = parseFloat(rule.value);

  switch (rule.operator) {
    case 'gt':       return !isNaN(numVal) && !isNaN(ruleNum) && numVal > ruleNum;
    case 'lt':       return !isNaN(numVal) && !isNaN(ruleNum) && numVal < ruleNum;
    case 'gte':      return !isNaN(numVal) && !isNaN(ruleNum) && numVal >= ruleNum;
    case 'lte':      return !isNaN(numVal) && !isNaN(ruleNum) && numVal <= ruleNum;
    case 'eq':       return String(value) === rule.value || numVal === ruleNum;
    case 'neq':      return String(value) !== rule.value && numVal !== ruleNum;
    case 'contains': return String(value).toLowerCase().includes(rule.value.toLowerCase());
    case 'is_empty': return value === null || value === undefined || String(value).trim() === '';
    case 'not_empty':return value !== null && value !== undefined && String(value).trim() !== '';
    default:         return false;
  }
}

/** Returns merged inline style from all matching rules for a specific cell */
export function getCellStyle(
  rules: ConditionalFormattingRule[],
  columnKey: string,
  cellValue: unknown,
  rowData: Record<string, unknown>
): React.CSSProperties {
  const style: React.CSSProperties = {};

  for (const rule of rules) {
    const matchesColumn = rule.column === columnKey || rule.column === '*';
    if (!matchesColumn) continue;

    const testValue = rule.applyTo === 'row'
      ? rowData[columnKey]   // each cell in row checks its own value
      : cellValue;

    const ruleTarget = rule.applyTo === 'row' ? rowData[rule.column] : cellValue;
    if (!testRule(rule, ruleTarget)) continue;

    if (rule.bgColor)   style.backgroundColor = rule.bgColor;
    if (rule.textColor) style.color = rule.textColor;
    if (rule.bold)      style.fontWeight = 'bold';
    break; // first match wins
  }

  return style;
}

/** Returns row-level style from the first matching row rule */
export function getRowStyle(
  rules: ConditionalFormattingRule[],
  rowData: Record<string, unknown>
): React.CSSProperties {
  const rowRules = rules.filter((r) => r.applyTo === 'row');
  for (const rule of rowRules) {
    const val = rowData[rule.column] ?? rowData['x'] ?? rowData['y'];
    if (!testRule(rule, val)) continue;
    const style: React.CSSProperties = {};
    if (rule.bgColor)   style.backgroundColor = rule.bgColor;
    if (rule.textColor) style.color = rule.textColor;
    if (rule.bold)      style.fontWeight = 'bold';
    return style;
  }
  return {};
}

/**
 * Same rule engine as the table, applied to a single headline value — lets a Stat/KPI
 * widget use the full rule set (any operator, multiple rules, custom colors) instead of
 * the old fixed "warn/critical, above/below" two-severity model. Match by the synthetic
 * 'value' column, or '*' for a rule meant to apply regardless of column naming.
 */
export function getStatValueStyle(
  rules: ConditionalFormattingRule[] | undefined,
  value: unknown,
): React.CSSProperties {
  if (!rules?.length) return {};
  for (const rule of rules) {
    if (rule.column !== 'value' && rule.column !== '*') continue;
    if (!testRule(rule, value)) continue;
    const style: React.CSSProperties = {};
    if (rule.bgColor)   style.backgroundColor = rule.bgColor;
    if (rule.textColor) style.color = rule.textColor;
    if (rule.bold)      style.fontWeight = 'bold';
    return style;
  }
  return {};
}

/**
 * Same rule engine, applied per data point on a chart series — e.g. a bar that breaches
 * a critical threshold renders in that rule's color, the industry-standard "highlight
 * abnormal values" pattern for bar/column charts. Matches rules by series/metric name
 * (the chart equivalent of a table "column"), or '*' for any series. Returns one color
 * per point (undefined = no override, use the series' normal color).
 */
export function getSeriesPointColors(
  rules: ConditionalFormattingRule[] | undefined,
  seriesName: string,
  values: unknown[],
): (string | undefined)[] {
  if (!Array.isArray(values)) return [];
  if (!rules?.length) return values.map(() => undefined);
  const applicable = rules.filter((r) => r.column === seriesName || r.column === '*');
  if (!applicable.length) return values.map(() => undefined);
  return values.map((value) => {
    for (const rule of applicable) {
      if (testRule(rule, value)) return rule.bgColor;
    }
    return undefined;
  });
}
