import type { PrepStep } from '@/api/prep';
import { stepParts } from '@/api/prep';

type T = (key: string, values?: Record<string, string | number>) => string;

const list = (cols: unknown, max = 3): string => {
  const arr = Array.isArray(cols) ? (cols as string[]) : cols && typeof cols === 'object' ? Object.keys(cols) : [];
  const shown = arr.slice(0, max).join(', ');
  return arr.length > max ? `${shown} +${arr.length - max}` : shown;
};

/** One readable sentence per step, e.g. "Read Registered as a date". */
export function stepSentence(step: PrepStep, t: T): string {
  const [kind, a] = stepParts(step);
  const note = typeof a.note === 'string' && a.note.trim() ? a.note.trim() : null;
  if (note) return note;
  const cols = list(a.columns);
  switch (kind) {
    case 'rename': {
      const pairs = Object.entries((a.columns as Record<string, string>) ?? {});
      return pairs.length === 1
        ? t('s_rename_one', { from: pairs[0][0], to: pairs[0][1] })
        : t('s_rename_many', { count: pairs.length });
    }
    case 'cast':
      return t('s_cast', { columns: cols });
    case 'set_types':
      return t('s_set_types', { columns: cols });
    case 'drop':
      return t('s_drop', { columns: cols });
    case 'select':
      return t('s_select', { columns: cols });
    case 'clean':
      return t('s_clean', { columns: cols });
    case 'replace':
      return t('s_replace', { columns: cols });
    case 'change_case':
      return t('s_case', { columns: cols, case: String(a.case ?? 'title') });
    case 'parse_date':
      return t('s_parse_date', { columns: cols });
    case 'parse_number':
      return t('s_parse_number', { columns: cols });
    case 'fill':
      return t('s_fill', { columns: cols, how: t(`fill_${String(a.strategy ?? 'value')}`) });
    case 'fill_na':
      return t('s_fill', { columns: list(a.values), how: t('fill_value') });
    case 'fill_down':
      return t('s_fill', { columns: cols, how: t('fill_down') });
    case 'split':
      return t('s_split', { column: String(a.column ?? '') });
    case 'extract':
      return t('s_extract', { column: String(a.column ?? ''), into: String(a.into ?? '') });
    case 'concat':
      return t('s_concat', { into: String(a.into ?? ''), columns: cols });
    case 'mask':
      return t('s_mask', { columns: cols });
    case 'flatten_json':
      return t('s_flatten', { column: String(a.column ?? '') });
    case 'explode':
      return t('s_explode', { column: String(a.column ?? '') });
    case 'dedupe':
      return Array.isArray(a.keys) && a.keys.length ? t('s_dedupe_by', { columns: list(a.keys) }) : t('s_dedupe');
    case 'filter_rows':
      return t(a.action === 'remove' ? 's_filter_remove' : 's_filter_keep', { count: (a.conditions as unknown[])?.length ?? 0 });
    case 'filter':
      return t('s_filter_keep', { count: 1 });
    case 'sort':
      return t('s_sort', { columns: list(a.by) });
    case 'formula':
    case 'derive':
    case 'conditional':
      return t('s_new_column', { column: String(a.into ?? list(a.columns)) });
    case 'aggregate':
      return t('s_group', { columns: list(a.by) || '—' });
    case 'pivot':
      return t('s_pivot', { column: String(a.on ?? '') });
    case 'unpivot':
      return t('s_unpivot', { columns: cols });
    case 'join':
      return t('s_join', { asset: String(a.asset ?? '') });
    case 'union':
      return t('s_union', { asset: String(a.asset ?? '') });
    case 'cluster':
      return t('s_cluster', { column: String(a.column ?? '') });
    case 'validate': {
      const cols = [
        ...((a.not_null as string[]) ?? []),
        ...((a.unique as string[]) ?? []),
        ...Object.keys((a.accepted_values as object) ?? {}),
        ...Object.keys((a.range as object) ?? {}),
      ];
      return t('s_validate', { columns: list(Array.from(new Set(cols))) });
    }
    case 'sql':
      return t('s_sql');
    case 'predict':
      return t('s_predict', { name: String(a.into ?? '') || t('s_predict_default') });
    case 'ai_answer':
      return t('s_ai_answer', { columns: list(a.columns) });
    default:
      return kind;
  }
}

export const isDisabled = (step: PrepStep) => Boolean(stepParts(step)[1].disabled);

export function toggleDisabled(step: PrepStep): PrepStep {
  const [kind, a] = stepParts(step);
  const next = { ...a };
  if (next.disabled) delete next.disabled;
  else next.disabled = true;
  return { [kind]: next };
}
