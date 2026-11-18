// Ported from ../aicser/client/src/components/prep/ColumnMeaningModal.tsx @ 749d38d (see PORTING.md). UI rewritten
// (React Hook Form + Zod). Not ported yet: "Add to the semantic model" (Semantic models aren't on desktop yet).
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { COLUMN_ROLES, type ColumnMeaning, type ColumnRole } from '@/api/prep';
import { Button } from '@/components/aicser-ui/button';
import { Checkbox } from '@/components/aicser-ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/aicser-ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { Textarea } from '@/components/aicser-ui/textarea';
import { guessRole } from '@/lib/prep/columnRoles';
import { tPrep as t, tRoles as tr } from '@/lib/prep/i18n';
import { z } from 'zod';

const schema = z.object({
  description: z.string().max(500),
  role: z.enum(COLUMN_ROLES),
  personal: z.boolean(),
});
type Values = z.infer<typeof schema>;

/**
 * What one output column means: a description, a role and whether it holds personal data. Saved on the recipe and
 * written onto the table the recipe produces, where Ask and the semantic model read it.
 */
export function ColumnMeaningDialog({
  column,
  kind,
  value,
  onClose,
  onSave,
}: {
  column: string;
  kind: string;
  value?: ColumnMeaning;
  onClose: () => void;
  onSave: (meaning: ColumnMeaning) => Promise<void>;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      description: value?.description ?? '',
      role: (value?.role as ColumnRole | null | undefined) ?? guessRole(column, kind),
      personal: Boolean(value?.personal),
    },
  });

  const save = form.handleSubmit(async (v) => {
    try {
      await onSave({ description: v.description.trim() || null, role: v.role, personal: v.personal });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('meaning_title', { column })}</DialogTitle>
          <DialogDescription>{t('meaning_where')}</DialogDescription>
        </DialogHeader>
        <form id="column-meaning" className="flex flex-col gap-4" onSubmit={(e) => void save(e)}>
          <Controller
            control={form.control}
            name="description"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="meaning-description">{t('meaning_description')}</FieldLabel>
                <Textarea
                  id="meaning-description"
                  rows={2}
                  maxLength={500}
                  placeholder={t('meaning_description_placeholder')}
                  {...field}
                />
                <FieldDescription>{t('meaning_description_hint')}</FieldDescription>
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="role"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="meaning-role">{t('meaning_role')}</FieldLabel>
                <NativeSelect
                  id="meaning-role"
                  className="w-full"
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                >
                  {COLUMN_ROLES.map((r) => (
                    <NativeSelectOption key={r} value={r}>
                      {tr(`role_${r}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>{tr(`role_${field.value}_desc`)}</FieldDescription>
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="personal"
            render={({ field }) => (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} />
                {t('meaning_personal')}
              </label>
            )}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" form="column-meaning" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
            {t('meaning_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
