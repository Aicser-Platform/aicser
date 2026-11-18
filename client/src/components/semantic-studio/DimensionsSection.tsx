import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { createDimension, deleteDimension, updateDimension, type Dimension } from '@/api/semanticStudio';
import { QueryState } from '@/components/aicser-ui/page';
import { Tag } from '@/components/prep/controls';
import { Button } from '@/components/aicser-ui/button';
import type { SemanticModel } from '@/hooks/useSemanticStudioModel';
import { ConfirmDialog } from './ConfirmDialog';
import { DefinitionDialog, type DefinitionValues } from './DefinitionDialog';

/** Dimensions of one connection: categories to group by and dates to show trends by. */
export function DimensionsSection({ model, projectId }: { model: SemanticModel; projectId: string | null }) {
  const [editing, setEditing] = useState<{ dimension?: Dimension } | null>(null);
  const [removing, setRemoving] = useState<Dimension | null>(null);
  const dimensions = model.dimensions.data ?? [];

  const save = async (v: DefinitionValues) => {
    const body = {
      name: v.name.trim(),
      expression: v.expression.trim(),
      description: v.description,
      dimension_type: v.dimension_type,
      default_grain: v.dimension_type === 'time' ? v.default_grain : null,
    };
    if (editing?.dimension) await updateDimension(editing.dimension.id, body);
    else await createDimension({ ...body, data_source_id: model.dataSourceId, project_id: projectId });
    toast.success(editing?.dimension ? 'Dimension saved' : 'Dimension added');
    await model.refresh();
  };

  return (
    <section aria-label="Dimensions" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <header className="flex items-center justify-between">
        <h3 className="font-semibold">Dimensions</h3>
        <Button size="sm" variant="outline" onClick={() => setEditing({})}>
          <Plus /> Add
        </Button>
      </header>
      <QueryState query={model.dimensions} feature="Semantic models">
        <table aria-label="Dimensions" className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Column or expression</th>
              <th className="py-2 pr-3 font-medium">Kind</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {dimensions.map((d) => (
              <tr key={d.id} className="border-b align-top last:border-0">
                <td className="py-2 pr-3">
                  <p className="font-medium">{d.name}</p>
                  {d.description && <p className="text-xs text-muted-foreground">{d.description}</p>}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{d.expression}</td>
                <td className="py-2 pr-3">
                  {d.dimension_type === 'time' ? (
                    <Tag tone="info">Time · by {d.default_grain || 'day'}</Tag>
                  ) : (
                    <Tag>Category</Tag>
                  )}
                </td>
                <td className="py-2">
                  <span className="flex justify-end gap-0.5">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${d.name}`}
                      title="Edit"
                      onClick={() => setEditing({ dimension: d })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${d.name}`}
                      title="Delete"
                      onClick={() => setRemoving(d)}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
            {!dimensions.length && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted-foreground">
                  No dimensions yet. Add how people group and filter, such as country, product or order date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </QueryState>
      {editing && (
        <DefinitionDialog
          kind="dimension"
          initial={
            editing.dimension
              ? {
                  editing: true,
                  name: editing.dimension.name,
                  expression: editing.dimension.expression,
                  description: editing.dimension.description ?? '',
                  dimension_type: editing.dimension.dimension_type,
                  default_grain: editing.dimension.default_grain ?? 'month',
                }
              : {}
          }
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Delete ${removing?.name ?? ''}?`}
        description="Charts and answers grouped by it stop working."
        action="Delete dimension"
        onConfirm={async () => {
          if (!removing) return;
          await deleteDimension(removing.id);
          await model.refresh();
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
