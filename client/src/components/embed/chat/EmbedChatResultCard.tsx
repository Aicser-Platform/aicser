'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

type Tab = 'chart' | 'query' | 'table';

const MAX_TABLE_ROWS = 100;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * The result of one answer, as the in-app chat shows it: a titled card with Chart, Query (SQL)
 * and Table tabs. Tabs only appear for what the answer has.
 */
export function EmbedChatResultCard({
  title,
  chart,
  sql,
  rows,
}: {
  title: string;
  chart?: React.ReactNode;
  sql?: string;
  rows?: Record<string, unknown>[] | null;
}) {
  const t = useTranslations('embed_chat');
  const tabs = useMemo(() => {
    const list: Tab[] = [];
    if (chart) list.push('chart');
    if (sql) list.push('query');
    if (rows && rows.length) list.push('table');
    return list;
  }, [chart, sql, rows]);
  const [tab, setTab] = useState<Tab | null>(null);
  const [open, setOpen] = useState(true);
  const active = tab && tabs.includes(tab) ? tab : tabs[0];
  if (!active) return null;

  const columns = rows?.length ? Object.keys(rows[0]) : [];
  const shown = rows?.slice(0, MAX_TABLE_ROWS) ?? [];

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-bg-container">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
          VIS
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{title}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-text-secondary transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>

      {open && (
        <>
          <div role="tablist" className="flex gap-4 border-b border-border px-3">
            {tabs.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active === key}
                onClick={() => setTab(key)}
                className={`-mb-px border-0 border-b-2 bg-transparent px-1 py-2 text-sm ${
                  active === key
                    ? 'border-[var(--ant-color-primary,#00c2cb)] font-medium text-text'
                    : 'border-transparent text-text-secondary hover:text-text'
                }`}
              >
                {t(`tab_${key}`)}
              </button>
            ))}
          </div>

          <div className="p-3">
            {active === 'chart' && chart}
            {active === 'query' && (
              <pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--ant-color-fill-tertiary,rgba(0,0,0,0.04))] p-3 font-mono text-xs leading-relaxed text-text">
                {sql}
              </pre>
            )}
            {active === 'table' && (
              <>
                <div className="max-h-80 overflow-auto rounded-lg border border-border">
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 bg-bg-container">
                      <tr>
                        {columns.map((col) => (
                          <th
                            key={col}
                            className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold text-text-secondary"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row, i) => (
                        <tr key={i} className="odd:bg-[var(--ant-color-fill-quaternary,rgba(0,0,0,0.02))]">
                          {columns.map((col) => (
                            <td key={col} className="whitespace-nowrap px-3 py-1.5 text-text">
                              {formatCell(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows && rows.length > shown.length && (
                  <p className="mb-0 mt-2 text-xs text-text-secondary">
                    {t('rows_shown', { shown: shown.length, total: rows.length })}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
