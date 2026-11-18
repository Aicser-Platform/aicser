import { List, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  CARDINALITIES,
  JOIN_TYPES,
  autoDetectRelationships,
  createRelationship,
  deleteRelationship,
  updateRelationship,
  type Relationship,
  type RelationshipInput,
} from '@/api/semanticStudio';
import { QueryState } from '@/components/aicser-ui/page';
import { Tag } from '@/components/prep/controls';
import { Button } from '@/components/aicser-ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import type { SemanticModel } from '@/hooks/useSemanticStudioModel';
import { CARDINALITY_WORDS, cardinalityLabel } from '@/lib/semantic/diagram';
import { errorText } from '@/lib/semantic/refs';
import { ConfirmDialog } from './ConfirmDialog';
import { RelationshipDiagram } from './RelationshipDiagram';

type Link = Pick<RelationshipInput, 'from_table' | 'from_column' | 'to_table' | 'to_column'>;
type Patch = { cardinality?: string; join_type?: string };

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <NativeSelect aria-label={label} className="w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value="">Choose…</NativeSelectOption>
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}

/** New relationship: from the Add button (empty), or from a link drawn on the diagram (columns filled in). */
function RelationshipDialog({
  model,
  initial,
  onClose,
}: {
  model: SemanticModel;
  initial?: Link;
  onClose: () => void;
}) {
  const [v, setV] = useState<RelationshipInput>({
    from_table: initial?.from_table ?? '',
    from_column: initial?.from_column ?? '',
    to_table: initial?.to_table ?? '',
    to_column: initial?.to_column ?? '',
    join_type: 'LEFT',
    cardinality: 'one_to_many',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<RelationshipInput>) => setV((cur) => ({ ...cur, ...patch }));
  const tables = model.tables.map((t) => ({ value: t.name, label: t.name }));
  const columnsOf = (table: string) =>
    (model.tables.find((t) => t.name === table)?.columns ?? []).map((c) => ({ value: c.name, label: c.name }));
  const ready = v.from_table && v.from_column && v.to_table && v.to_column;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await createRelationship(model.dataSourceId, v);
      toast.success('Relationship added');
      await model.refresh();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New relationship</DialogTitle>
          <DialogDescription>
            {initial
              ? `${initial.from_table}.${initial.from_column} → ${initial.to_table}.${initial.to_column}: how many rows match on each side?`
              : 'How two tables connect, e.g. orders.customer_id = customers.customer_id.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="From table"
            value={v.from_table}
            options={tables}
            onChange={(t) => set({ from_table: t, from_column: '' })}
          />
          <Select
            label="From column"
            value={v.from_column}
            options={columnsOf(v.from_table)}
            onChange={(c) => set({ from_column: c })}
          />
          <Select
            label="To table"
            value={v.to_table}
            options={tables}
            onChange={(t) => set({ to_table: t, to_column: '' })}
          />
          <Select
            label="To column"
            value={v.to_column}
            options={columnsOf(v.to_table)}
            onChange={(c) => set({ to_column: c })}
          />
          <Select
            label="Cardinality"
            value={v.cardinality}
            options={CARDINALITIES.map((c) => ({
              value: c,
              label: `${cardinalityLabel(c)} · ${CARDINALITY_WORDS[c]}`,
            }))}
            onChange={(c) => set({ cardinality: c })}
          />
          <Select
            label="Join"
            value={v.join_type}
            options={JOIN_TYPES.map((j) => ({ value: j, label: j }))}
            onChange={(j) => set({ join_type: j })}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready || busy} onClick={() => void save()}>
            Add relationship
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The joins as a list beside the diagram (a toggle), to change or delete them without finding the line. */
function JoinList({
  relationships,
  onChange,
  onDelete,
  onClose,
}: {
  relationships: Relationship[];
  onChange: (r: Relationship, patch: Patch) => void;
  onDelete: (r: Relationship) => void;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Join list"
      className="absolute inset-y-0 right-0 z-10 flex w-[min(560px,100%)] flex-col border-l bg-card shadow-lg"
    >
      <header className="flex items-center justify-between border-b px-3 py-2">
        <h4 className="text-sm font-semibold">Join list ({relationships.length})</h4>
        <Button size="icon-sm" variant="ghost" aria-label="Close join list" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table aria-label="Join list" className="w-full text-sm">
          <thead className="sticky top-0 bg-card text-left text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 font-medium">From → To</th>
              <th className="px-3 py-2 font-medium">Cardinality</th>
              <th className="px-3 py-2 font-medium">Join</th>
              <th className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {relationships.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-3 py-1.5 font-mono text-xs">
                  <p>
                    {r.from_table}.{r.from_column}
                  </p>
                  <p className="text-muted-foreground">
                    → {r.to_table}.{r.to_column} {r.to_data_source_id && <Tag>other connection</Tag>}
                  </p>
                </td>
                <td className="px-3 py-1.5">
                  <NativeSelect
                    size="sm"
                    aria-label={`Cardinality of ${r.from_table} to ${r.to_table}`}
                    value={r.cardinality}
                    onChange={(e) => onChange(r, { cardinality: e.target.value })}
                  >
                    {CARDINALITIES.map((c) => (
                      <NativeSelectOption key={c} value={c}>
                        {cardinalityLabel(c)} · {CARDINALITY_WORDS[c]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </td>
                <td className="px-3 py-1.5">
                  <NativeSelect
                    size="sm"
                    aria-label={`Join of ${r.from_table} to ${r.to_table}`}
                    value={r.join_type.toUpperCase()}
                    onChange={(e) => onChange(r, { join_type: e.target.value })}
                  >
                    {JOIN_TYPES.map((j) => (
                      <NativeSelectOption key={j} value={j}>
                        {j}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${r.from_table} to ${r.to_table}`}
                    onClick={() => onDelete(r)}
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
            {!relationships.length && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No relationships yet. Drag from a column to a column of another table, or find them.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </aside>
  );
}

/**
 * How the connection's tables connect: a full-height diagram (drag tables; drag column to column to join), with the
 * join list as a panel you open beside it.
 */
export function RelationshipsSection({ model }: { model: SemanticModel }) {
  const [adding, setAdding] = useState<{ link?: Link } | null>(null);
  const [removing, setRemoving] = useState<Relationship | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const relationships = model.relationships.data ?? [];
  const { dataSourceId, refresh } = model;

  const detect = async () => {
    setDetecting(true);
    try {
      const n = await autoDetectRelationships(dataSourceId);
      toast.success(n ? `Found ${n} relationship${n === 1 ? '' : 's'}` : 'No new relationships found');
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setDetecting(false);
    }
  };
  const onChange = useCallback(
    (r: Relationship, patch: Patch) => {
      updateRelationship(dataSourceId, r.id, patch)
        .then(() => refresh())
        .catch((err: unknown) => toast.error(errorText(err)));
    },
    [dataSourceId, refresh]
  );
  const onDelete = useCallback((r: Relationship) => setRemoving(r), []);
  const onConnect = useCallback((link: Link) => setAdding({ link }), []);

  return (
    <section
      aria-label="Relationships"
      // Fills the window under the shell header, the page padding and the studio header.
      className="flex h-[calc(100dvh-11rem)] min-h-105 flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Relationships</h3>
          <p className="text-sm text-muted-foreground">
            Drag tables to arrange them. Drag from a column to a column of another table to join them.
          </p>
        </div>
        <span className="flex gap-2">
          <Button size="sm" variant="outline" disabled={detecting} onClick={() => void detect()}>
            <Sparkles /> Find relationships
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAdding({})}>
            <Plus /> Add
          </Button>
          <Button
            size="sm"
            variant={listOpen ? 'secondary' : 'outline'}
            aria-pressed={listOpen}
            onClick={() => setListOpen((o) => !o)}
          >
            <List /> Join list ({relationships.length})
          </Button>
        </span>
      </header>
      <QueryState query={model.relationships} feature="Semantic models">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border">
          {model.tables.length ? (
            <RelationshipDiagram
              dataSourceId={dataSourceId}
              tables={model.tables}
              relationships={relationships}
              onConnect={onConnect}
              onChange={onChange}
              onDelete={onDelete}
            />
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {model.schema.isLoading ? 'Loading the tables…' : 'This connection has no tables to show.'}
            </p>
          )}
          {listOpen && (
            <JoinList
              relationships={relationships}
              onChange={onChange}
              onDelete={onDelete}
              onClose={() => setListOpen(false)}
            />
          )}
        </div>
      </QueryState>
      {adding && <RelationshipDialog model={model} initial={adding.link} onClose={() => setAdding(null)} />}
      <ConfirmDialog
        open={removing !== null}
        title="Delete this relationship?"
        description={
          removing ? `${removing.from_table}.${removing.from_column} → ${removing.to_table}.${removing.to_column}` : ''
        }
        action="Delete relationship"
        onConfirm={async () => {
          if (!removing) return;
          await deleteRelationship(dataSourceId, removing.id);
          await refresh();
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
