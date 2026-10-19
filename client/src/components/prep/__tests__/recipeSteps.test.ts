import { describe, expect, it } from 'vitest';
import {
  appendStep,
  convertName,
  describeStep,
  friendlyType,
  moveStep,
  quoteColumn,
  renameAllMapping,
  stepColumns,
  steps,
} from '../recipeSteps';
import { isDisabled, stepSentence, toggleDisabled } from '../stepText';

describe('recipe step helpers', () => {
  it('folds consecutive renames and type changes into one step', () => {
    expect(appendStep([steps.rename('a', 'A')], steps.rename('b', 'B'))).toEqual([{ rename: { columns: { a: 'A', b: 'B' } } }]);
    const typed = appendStep([steps.setType(['a'], { type: 'date', formats: ['%d-%b-%Y'] })], steps.setType(['b'], { type: 'number' }));
    expect(typed).toHaveLength(1);
    expect(Object.keys((typed[0].set_types as { columns: object }).columns)).toEqual(['a', 'b']);
  });

  it('does not fold into a step someone labelled or switched off', () => {
    const labelled = { rename: { columns: { a: 'A' }, note: 'Tidy names' } };
    expect(appendStep([labelled], steps.rename('b', 'B'))).toHaveLength(2);
  });

  it('folds consecutive removals without duplicates', () => {
    expect(appendStep([steps.remove(['a'])], steps.remove(['a', 'b']))).toEqual([{ drop: { columns: ['a', 'b'] } }]);
  });

  it('moves steps within bounds only', () => {
    const list = [steps.trim(['a']), steps.trim(['b'])];
    expect(moveStep(list, 0, 1)[0]).toEqual(steps.trim(['b']));
    expect(moveStep(list, 0, -1)).toBe(list);
  });

  it('quotes column names', () => {
    expect(quoteColumn('a"b')).toBe('"a""b"');
  });

  it('lists the columns a step touches', () => {
    expect(stepColumns(steps.rename('a', 'A'))).toEqual(['a']);
    expect(stepColumns(steps.split('name', { mode: 'whitespace' }))).toEqual(['name']);
  });

  it('converts column names to a convention and refuses collisions', () => {
    expect(convertName('Student ID', 'snake')).toBe('student_id');
    expect(convertName('totalAmount', 'title')).toBe('Total Amount');
    expect(convertName('Name (EN)', 'camel')).toBe('nameEn');
    expect(renameAllMapping(['Student ID', 'name'], 'snake')).toEqual({ 'Student ID': 'student_id' });
    expect(renameAllMapping(['A b', 'a_b'], 'snake')).toBeNull();
  });

  it('maps engine types to plain words', () => {
    expect(friendlyType('int64')).toBe('integer');
    expect(friendlyType('timestamp[us]')).toBe('datetime');
    expect(friendlyType('date32[day]')).toBe('date');
    expect(friendlyType('string')).toBe('text');
  });

  it('describes steps in sentences and honours notes', () => {
    const t = (k: string, v?: Record<string, string | number>) => `${k}:${JSON.stringify(v ?? {})}`;
    expect(stepSentence(steps.rename('a', 'A'), t)).toBe('s_rename_one:{"from":"a","to":"A"}');
    expect(stepSentence(steps.renameMany({ a: 'b' }, 'Column names in snake_case'), t)).toBe('Column names in snake_case');
    expect(describeStep(steps.trim(['city']), (k) => k)).toBe('clean: city');
  });

  it('switches a step off and on without losing it', () => {
    const off = toggleDisabled(steps.trim(['a']));
    expect(isDisabled(off)).toBe(true);
    expect(isDisabled(toggleDisabled(off))).toBe(false);
  });
});
