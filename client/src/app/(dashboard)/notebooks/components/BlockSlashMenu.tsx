'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { CellType } from '@/services/notebookService';
import { TYPE_ICON } from './NotebookCell';

const SLASH_TYPES: CellType[] = ['markdown', 'python', 'sql', 'chart', 'pivot'];

export function slashFilter(query: string): CellType[] {
  const q = query.trim().toLowerCase();
  const aliases: Record<CellType, string[]> = {
    markdown: ['text', 'note', 'md', 'markdown', 'heading', 'h1'],
    python: ['code', 'python', 'py', 'pandas'],
    sql: ['sql', 'query', 'data'],
    chart: ['chart', 'viz', 'graph'],
    pivot: ['pivot', 'table', 'crosstab'],
  };
  if (!q) return SLASH_TYPES;
  return SLASH_TYPES.filter((type) => aliases[type].some((a) => a.startsWith(q) || a.includes(q)));
}

export function BlockSlashMenu({
  filter,
  onPick,
}: {
  filter: string;
  onPick: (type: CellType) => void;
}) {
  const t = useTranslations('notebooks');
  const types = slashFilter(filter);
  if (!types.length) return null;

  return (
    <div className="nb-slash-menu" role="listbox" aria-label={t('slash_menu')}>
      <p className="nb-slash-menu__title">{t('slash_menu')}</p>
      <ul className="nb-slash-menu__list">
        {types.map((type) => (
          <li key={type}>
            <button type="button" className="nb-slash-menu__item" role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(type)}>
              <span className="nb-slash-menu__icon" aria-hidden>{TYPE_ICON[type]}</span>
              <span className="nb-slash-menu__label">{t(`slash_${type}`)}</span>
              <span className="nb-slash-menu__hint">{t(`type_${type}`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** True when the only content is a slash command on the last line (Notion-style). */
export function activeSlashLine(source: string): string | null {
  const lines = source.split('\n');
  const last = lines[lines.length - 1] ?? '';
  const m = /^\/([a-zA-Z]*)$/.exec(last);
  if (!m) return null;
  const before = lines.slice(0, -1).join('\n').trim();
  if (before) return null;
  return m[1];
}
