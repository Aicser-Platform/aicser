import { ChevronDown, ChevronRight, Search, Table2 } from 'lucide-react';
import { useState } from 'react';
import type { SchemaTable } from '@/lib/desktop/dataSources';
import { Input } from '@/components/aicser-ui/input';
import { usesColumn } from '@/lib/semantic/refs';
import { cn } from '@/lib/ui/utils';
import { Segmented } from '@/components/prep/controls';

/**
 * The connection's tables and columns beside the metrics: which columns a definition uses, and one click to start a
 * metric or dimension from a column.
 */
export function SchemaPanel({
  tables,
  expressions,
  selected,
  onSelect,
}: {
  tables: SchemaTable[];
  /** Every metric and dimension expression, to mark the columns in use. */
  expressions: string[];
  selected: { table: string; column: string } | null;
  onSelect: (table: string, column: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<'all' | 'unused'>('all');
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const used = (column: string) => expressions.some((e) => usesColumn(e, column));
  const total = tables.reduce((n, t) => n + t.columns.length, 0);
  const inUse = tables.reduce((n, t) => n + t.columns.filter((c) => used(c.name)).length, 0);
  const q = query.trim().toLowerCase();

  return (
    <aside aria-label="Schema" className="flex w-64 shrink-0 flex-col gap-2 rounded-xl border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Table2 className="size-4 text-primary" aria-hidden="true" /> Schema
        </h3>
        <span className="text-xs text-muted-foreground">
          {inUse} of {total} columns used
        </span>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-7"
          placeholder="Find a column"
          aria-label="Find a column"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <Segmented
        size="xs"
        label="Columns shown"
        value={show}
        onChange={setShow}
        options={[
          { value: 'all', label: 'All columns' },
          { value: 'unused', label: 'Not used yet' },
        ]}
      />
      <ul className="min-h-0 flex-1 overflow-y-auto text-sm">
        {tables.map((t) => {
          const cols = t.columns.filter(
            (c) => (!q || c.name.toLowerCase().includes(q)) && (show === 'all' || !used(c.name))
          );
          if (!cols.length && (q || show === 'unused')) return null;
          const open = !closed.has(t.name) || Boolean(q);
          return (
            <li key={t.name}>
              <button
                type="button"
                aria-expanded={open}
                className="flex w-full items-center gap-1 rounded px-1 py-1 text-left font-medium hover:bg-muted"
                onClick={() =>
                  setClosed((cur) => {
                    const next = new Set(cur);
                    if (next.has(t.name)) next.delete(t.name);
                    else next.add(t.name);
                    return next;
                  })
                }
              >
                {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                <span className="flex-1 truncate">{t.name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t.columns.filter((c) => used(c.name)).length}/{t.columns.length}
                </span>
              </button>
              {open && (
                <ul aria-label={`Columns of ${t.name}`}>
                  {cols.map((c) => {
                    const on = selected?.table === t.name && selected.column === c.name;
                    return (
                      <li key={c.name}>
                        <button
                          type="button"
                          aria-pressed={on}
                          className={cn(
                            'flex w-full items-center gap-2 rounded py-0.5 pr-1 pl-6 text-left hover:bg-muted',
                            on && 'bg-primary/10'
                          )}
                          onClick={() => onSelect(t.name, c.name)}
                        >
                          <span className="flex-1 truncate">{c.name}</span>
                          {used(c.name) && <span className="text-xs text-primary-active">used</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        {!tables.length && <li className="text-xs text-muted-foreground">No tables found.</li>}
      </ul>
    </aside>
  );
}
