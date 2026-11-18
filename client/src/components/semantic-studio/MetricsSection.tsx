import { Ban, BadgeCheck, Pencil, Plus, RotateCcw, Trash2, Undo2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  createDimension,
  createMetric,
  deleteMetric,
  metricAction,
  metricStatus,
  updateMetric,
  type Metric,
  type MetricAction,
  type MetricStatus,
} from '@/api/semanticStudio';
import { QueryState } from '@/components/aicser-ui/page';
import { Tag, type Tone } from '@/components/prep/controls';
import { Button } from '@/components/aicser-ui/button';
import type { SemanticModel } from '@/hooks/useSemanticStudioModel';
import { columnRef, errorText, usesColumn } from '@/lib/semantic/refs';
import { ConfirmDialog } from './ConfirmDialog';
import { DefinitionDialog, type DefinitionValues } from './DefinitionDialog';
import { SchemaPanel } from './SchemaPanel';

const STATUS: Record<MetricStatus, { label: string; tone: Tone }> = {
  official: { label: 'Official', tone: 'good' },
  changed: { label: 'Official · change waiting', tone: 'info' },
  draft: { label: 'Draft', tone: 'neutral' },
  retired: { label: 'Retired', tone: 'warn' },
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** Metrics of one connection: the schema beside them, add/edit, and certify (official) or retire. */
export function MetricsSection({ model, projectId }: { model: SemanticModel; projectId: string | null }) {
  const [editing, setEditing] = useState<{ metric?: Metric; start?: Partial<DefinitionValues> } | null>(null);
  const [dimensionStart, setDimensionStart] = useState<Partial<DefinitionValues> | null>(null);
  const [removing, setRemoving] = useState<Metric | null>(null);
  const [column, setColumn] = useState<{ table: string; column: string } | null>(null);
  const metrics = model.metrics.data ?? [];
  const expressions = [...metrics.map((m) => m.expression), ...(model.dimensions.data ?? []).map((d) => d.expression)];
  const columnType = column
    ? (model.tables.find((t) => t.name === column.table)?.columns.find((c) => c.name === column.column)?.type ?? '')
    : '';
  const numeric = /int|float|double|decimal|numeric|real|number/i.test(columnType);

  const act = async (metric: Metric, action: MetricAction, done: string) => {
    try {
      await metricAction(metric.id, action);
      toast.success(done);
      await model.refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const save = async (values: DefinitionValues) => {
    const body = { name: values.name.trim(), expression: values.expression.trim(), description: values.description };
    if (editing?.metric) await updateMetric(editing.metric.id, body);
    else await createMetric({ ...body, data_source_id: model.dataSourceId, project_id: projectId });
    toast.success(editing?.metric ? 'Metric saved' : 'Metric added');
    await model.refresh();
  };

  return (
    <div className="flex min-h-[520px] gap-3">
      <SchemaPanel
        tables={model.tables}
        expressions={expressions}
        selected={column}
        onSelect={(table, name) => setColumn({ table, column: name })}
      />
      <section aria-label="Metrics" className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl border bg-card p-4">
        <header className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Metrics</h3>
          <Button size="sm" variant="outline" onClick={() => setEditing({})}>
            <Plus /> Add
          </Button>
        </header>
        {column && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span>
              <span className="text-muted-foreground">{column.table}.</span>
              <span className="font-medium">{column.column}</span>
              {columnType && <span className="text-muted-foreground"> · {columnType}</span>}
            </span>
            <span className="text-xs text-muted-foreground">
              {expressions.some((e) => usesColumn(e, column.column)) ? 'In use' : 'Not used yet'}
            </span>
            <span className="ml-auto flex gap-1.5">
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  setDimensionStart({ name: slug(column.column), expression: columnRef(column.table, column.column) })
                }
              >
                <Plus /> Dimension
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  setEditing({
                    start: numeric
                      ? {
                          name: `total_${slug(column.column)}`,
                          expression: `SUM(${columnRef(column.table, column.column)})`,
                        }
                      : {
                          name: `distinct_${slug(column.column)}`,
                          expression: `COUNT(DISTINCT ${columnRef(column.table, column.column)})`,
                        },
                  })
                }
              >
                <Plus /> {numeric ? 'Sum' : 'Count distinct'}
              </Button>
            </span>
          </div>
        )}
        <QueryState query={model.metrics} feature="Semantic models">
          <div className="overflow-x-auto">
            <table aria-label="Metrics" className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Calculation</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => {
                  const status = metricStatus(m);
                  return (
                    <tr key={m.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-3">
                        <p className="font-medium">{m.name}</p>
                        {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{m.expression}</td>
                      <td className="py-2 pr-3">
                        <Tag tone={STATUS[status].tone}>{STATUS[status].label}</Tag>
                      </td>
                      <td className="py-2">
                        <span className="flex justify-end gap-0.5">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Edit ${m.name}`}
                            title="Edit"
                            onClick={() => setEditing({ metric: m })}
                          >
                            <Pencil />
                          </Button>
                          {status === 'draft' && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Certify ${m.name}`}
                              title="Certify (make official)"
                              onClick={() => void act(m, 'certify', `${m.name} is official`)}
                            >
                              <BadgeCheck />
                            </Button>
                          )}
                          {status === 'changed' && (
                            <>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Publish the change to ${m.name}`}
                                title="Publish the change"
                                onClick={() => void act(m, 'publish', 'Change published')}
                              >
                                <Upload />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Discard the change to ${m.name}`}
                                title="Discard the change"
                                onClick={() => void act(m, 'discard', 'Change discarded')}
                              >
                                <Undo2 />
                              </Button>
                            </>
                          )}
                          {status === 'retired' ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Bring back ${m.name}`}
                              title="Bring back"
                              onClick={() => void act(m, 'reinstate', `${m.name} is back`)}
                            >
                              <RotateCcw />
                            </Button>
                          ) : (
                            status !== 'draft' && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Retire ${m.name}`}
                                title="Retire: charts keep working, Ask stops offering it"
                                onClick={() => void act(m, 'deprecate', `${m.name} retired`)}
                              >
                                <Ban />
                              </Button>
                            )
                          )}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Delete ${m.name}`}
                            title="Delete"
                            onClick={() => setRemoving(m)}
                          >
                            <Trash2 />
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {!metrics.length && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted-foreground">
                      No metrics yet. Add one, or pick a column in the schema to start from it.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </QueryState>
      </section>

      {editing && (
        <DefinitionDialog
          kind="metric"
          initial={
            editing.metric
              ? {
                  editing: true,
                  name: editing.metric.name,
                  expression: editing.metric.expression,
                  description: editing.metric.description ?? '',
                }
              : (editing.start ?? {})
          }
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
      {dimensionStart && (
        <DefinitionDialog
          kind="dimension"
          initial={dimensionStart}
          onSave={async (v) => {
            await createDimension({
              name: v.name.trim(),
              expression: v.expression.trim(),
              description: v.description,
              dimension_type: v.dimension_type,
              default_grain: v.dimension_type === 'time' ? v.default_grain : null,
              data_source_id: model.dataSourceId,
              project_id: projectId,
            });
            toast.success('Dimension added');
            await model.refresh();
          }}
          onClose={() => setDimensionStart(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Delete ${removing?.name ?? ''}?`}
        description="Charts and answers built on it stop working. Retire it instead to keep them running."
        action="Delete metric"
        onConfirm={async () => {
          if (!removing) return;
          await deleteMetric(removing.id);
          await model.refresh();
        }}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
