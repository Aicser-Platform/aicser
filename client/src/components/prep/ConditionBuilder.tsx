// Ported from ../aicser/client/src/components/prep/ConditionBuilder.tsx @ 749d38d (see PORTING.md). UI rewritten.
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/aicser-ui/button';
import { Input } from '@/components/aicser-ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { CONDITION_OPS, NO_VALUE, type Condition } from '@/lib/prep/conditions';
import { tPrep as t } from '@/lib/prep/i18n';
import { ColumnSelect, Segmented } from './controls';

/** Rows that match all (or any) of these conditions. Values are compared without case. */
export function ConditionBuilder({
  columns,
  value,
  onChange,
  match,
  onMatchChange,
}: {
  columns: string[];
  value: Condition[];
  onChange: (next: Condition[]) => void;
  match: 'all' | 'any';
  onMatchChange: (next: 'all' | 'any') => void;
}) {
  const set = (i: number, patch: Partial<Condition>) =>
    onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="flex flex-col gap-2">
      {value.length > 1 && (
        <Segmented
          size="xs"
          label={t('field_condition')}
          value={match}
          onChange={onMatchChange}
          options={[
            { value: 'all', label: t('match_all') },
            { value: 'any', label: t('match_any') },
          ]}
        />
      )}
      {value.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <ColumnSelect
            className="w-44"
            label={t('field_column')}
            placeholder={t('field_column')}
            value={c.column || undefined}
            options={columns}
            onChange={(column) => set(i, { column: column ?? '' })}
          />
          <NativeSelect
            className="w-40"
            aria-label={t('field_condition')}
            value={c.op}
            onChange={(e) => set(i, { op: e.target.value })}
          >
            {CONDITION_OPS.map((op) => (
              <NativeSelectOption key={op} value={op}>
                {t(`op_${op}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {!NO_VALUE.has(c.op) && (
            <Input
              className="h-8 w-40"
              value={c.value ?? ''}
              placeholder={
                c.op === 'in_list'
                  ? t('placeholder_in_list')
                  : c.op === 'matches'
                    ? t('placeholder_regex')
                    : t('placeholder_value')
              }
              onChange={(e) => set(i, { value: e.target.value })}
              aria-label={t('field_value')}
            />
          )}
          {c.op === 'between' && (
            <Input
              className="h-8 w-36"
              value={c.value2 ?? ''}
              placeholder={t('placeholder_and')}
              onChange={(e) => set(i, { value2: e.target.value })}
              aria-label={t('field_value')}
            />
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('remove_condition')}
            disabled={value.length === 1}
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => onChange([...value, { column: columns[0] ?? '', op: 'equals' }])}
      >
        <Plus /> {t('add_condition')}
      </Button>
    </div>
  );
}
