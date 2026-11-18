import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { deleteQuestion, saveQuestion, type VerifiedQuestion } from '@/api/semanticStudio';
import { QueryState } from '@/components/aicser-ui/page';
import { Button } from '@/components/aicser-ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/aicser-ui/field';
import { Input } from '@/components/aicser-ui/input';
import { Textarea } from '@/components/aicser-ui/textarea';
import type { SemanticModel } from '@/hooks/useSemanticStudioModel';
import { errorText } from '@/lib/semantic/refs';
import { z } from 'zod';
import { ConfirmDialog } from './ConfirmDialog';

const schema = z.object({
  question: z.string().trim().min(3, 'Write the question in 3 to 500 characters.').max(500),
  sql: z.string().trim().min(1, 'Write the SQL that answers it.').max(20000),
});
type Values = z.infer<typeof schema>;

function QuestionDialog({
  initial,
  onSave,
  onClose,
}: {
  initial?: VerifiedQuestion;
  onSave: (v: Values) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { question: initial?.question ?? '', sql: initial?.sql ?? '' },
  });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await onSave(v);
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit verified question' : 'New verified question'}</DialogTitle>
          <DialogDescription>
            When someone asks this (or something close), Ask answers with this checked SQL.
          </DialogDescription>
        </DialogHeader>
        <form id="verified-question" className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <Controller
            control={form.control}
            name="question"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="question-text">Question</FieldLabel>
                <Input
                  id="question-text"
                  placeholder="Revenue by month this year"
                  aria-invalid={fieldState.invalid}
                  {...field}
                />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="sql"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="question-sql">SQL</FieldLabel>
                <Textarea
                  id="question-sql"
                  rows={8}
                  className="font-mono text-xs"
                  spellCheck={false}
                  aria-invalid={fieldState.invalid}
                  {...field}
                />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
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
          <Button type="submit" form="verified-question" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Questions people checked the answer to; Ask reuses their SQL for the same question. */
export function QuestionsSection({ model }: { model: SemanticModel }) {
  const [editing, setEditing] = useState<{ question?: VerifiedQuestion } | null>(null);
  const [removing, setRemoving] = useState<VerifiedQuestion | null>(null);
  const questions = model.questions.data ?? [];
  return (
    <section aria-label="Verified questions" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Verified questions</h3>
          <p className="text-sm text-muted-foreground">Questions with a checked answer. Ask reuses their SQL.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing({})}>
          <Plus /> Add
        </Button>
      </header>
      <QueryState query={model.questions} feature="Semantic models">
        <ul aria-label="Verified questions" className="flex flex-col divide-y">
          {questions.map((q) => (
            <li key={q.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{q.question}</p>
                <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">
                  {q.sql}
                </pre>
                <p className="mt-1 text-xs text-muted-foreground">
                  Used {q.used} {q.used === 1 ? 'time' : 'times'}
                  {q.verified_at ? ` · verified ${new Date(q.verified_at).toLocaleDateString()}` : ''}
                </p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Edit ${q.question}`}
                title="Edit"
                onClick={() => setEditing({ question: q })}
              >
                <Pencil />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${q.question}`}
                title="Delete"
                onClick={() => setRemoving(q)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
          {!questions.length && (
            <li className="py-8 text-center text-sm text-muted-foreground">
              No verified questions yet. Add the questions people ask most, with the SQL that answers them.
            </li>
          )}
        </ul>
      </QueryState>
      {editing && (
        <QuestionDialog
          initial={editing.question}
          onSave={async (v) => {
            await saveQuestion(
              v,
              editing.question ? { questionId: editing.question.id } : { dataSourceId: model.dataSourceId }
            );
            toast.success('Question saved');
            await model.refresh();
          }}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Delete this question?"
        description={removing?.question}
        action="Delete question"
        onConfirm={async () => {
          if (!removing) return;
          await deleteQuestion(removing.id);
          await model.refresh();
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
