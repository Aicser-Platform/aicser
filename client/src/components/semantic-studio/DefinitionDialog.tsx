// Create or edit a metric or a dimension: name, SQL expression, description (+ type and grain for dimensions).
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { DIMENSION_GRAINS } from '@/api/semanticStudio';
import { Button } from '@/components/aicser-ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/aicser-ui/field';
import { Input } from '@/components/aicser-ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { Textarea } from '@/components/aicser-ui/textarea';
import { errorText } from '@/lib/semantic/refs';
import { z } from 'zod';

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give it a name.')
    .max(120)
    .regex(/^[A-Za-z][A-Za-z0-9_ ]*$/, 'Start with a letter; use letters, numbers, spaces and _.'),
  expression: z.string().trim().min(1, 'Write the SQL expression.'),
  description: z.string().max(500),
  dimension_type: z.enum(['category', 'time']),
  default_grain: z.string(),
});
export type DefinitionValues = z.infer<typeof schema>;

export function DefinitionDialog({
  kind,
  initial,
  onSave,
  onClose,
}: {
  kind: 'metric' | 'dimension';
  /** Existing values (edit) or a start (new from a column). */
  initial: Partial<DefinitionValues> & { editing?: boolean };
  onSave: (values: DefinitionValues) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<DefinitionValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial.name ?? '',
      expression: initial.expression ?? '',
      description: initial.description ?? '',
      dimension_type: initial.dimension_type ?? 'category',
      default_grain: initial.default_grain ?? 'month',
    },
  });
  const type = useWatch({ control: form.control, name: 'dimension_type' });
  const noun = kind === 'metric' ? 'metric' : 'dimension';
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSave(values);
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial.editing ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
          <DialogDescription>
            {kind === 'metric'
              ? 'A number people ask for, e.g. SUM(orders.total_amount). Ask, dashboards and agents use its name.'
              : 'A way to group or filter, e.g. customers.country, or a date to show trends by.'}
          </DialogDescription>
        </DialogHeader>
        <form id="semantic-definition" className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="definition-name">Name</FieldLabel>
                <Input id="definition-name" aria-invalid={fieldState.invalid} {...field} />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="expression"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="definition-expression">
                  {kind === 'metric' ? 'Calculation' : 'Column or expression'}
                </FieldLabel>
                <Textarea
                  id="definition-expression"
                  rows={3}
                  className="font-mono text-xs"
                  spellCheck={false}
                  aria-invalid={fieldState.invalid}
                  {...field}
                />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
          {kind === 'dimension' && (
            <div className="grid grid-cols-2 gap-3">
              <Controller
                control={form.control}
                name="dimension_type"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="definition-type">Kind</FieldLabel>
                    <NativeSelect
                      id="definition-type"
                      className="w-full"
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                    >
                      <NativeSelectOption value="category">Category</NativeSelectOption>
                      <NativeSelectOption value="time">Time</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                )}
              />
              {type === 'time' && (
                <Controller
                  control={form.control}
                  name="default_grain"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="definition-grain">Default grain</FieldLabel>
                      <NativeSelect
                        id="definition-grain"
                        className="w-full"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                      >
                        {DIMENSION_GRAINS.map((g) => (
                          <NativeSelectOption key={g} value={g}>
                            {g}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                />
              )}
            </div>
          )}
          <Controller
            control={form.control}
            name="description"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="definition-description">Description</FieldLabel>
                <Textarea id="definition-description" rows={2} maxLength={500} {...field} />
                <FieldDescription>Shown to people choosing it and to the AI.</FieldDescription>
              </Field>
            )}
          />
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="semantic-definition" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
