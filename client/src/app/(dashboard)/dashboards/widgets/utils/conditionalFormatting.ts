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
