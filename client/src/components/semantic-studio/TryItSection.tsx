import { useMutation } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
import { useState } from 'react';
import { DIMENSION_GRAINS, previewMetric } from '@/api/semanticStudio';
import { Button } from '@/components/aicser-ui/button';
import { Checkbox } from '@/components/aicser-ui/checkbox';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import type { SemanticModel } from '@/hooks/useSemanticStudioModel';

const cell = (v: unknown) =>
  v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** Runs a metric by dimensions the way Ask and dashboards would, and shows the SQL it compiles to. */
export function TryItSection({ model, projectId }: { model: SemanticModel; projectId: string | null }) {
  const metrics = (model.metrics.data ?? []).filter((m) => !m.deprecated_at);
  const dimensions = model.dimensions.data ?? [];
  const [metric, setMetric] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [grain, setGrain] = useState('');
  const hasTime = dimensions.some((d) => picked.includes(d.name) && d.dimension_type === 'time');
  const run = useMutation({
    mutationFn: () =>
      previewMetric({
        data_source_id: model.dataSourceId,
        metric,
        dimensions: picked,
        time_grain: hasTime && grain ? grain : null,
        project_id: projectId,
      }),
  });
  const rows = run.data?.rows ?? [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <section aria-label="Try it" className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div>
        <h3 className="font-semibold">Try it</h3>
        <p className="text-sm text-muted-foreground">
          Check a metric before people use it: pick it and how to split it.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Metric</span>
          <NativeSelect aria-label="Metric" className="w-60" value={metric} onChange={(e) => setMetric(e.target.value)}>
            <NativeSelectOption value="">Choose a metric…</NativeSelectOption>
            {metrics.map((m) => (
              <NativeSelectOption key={m.id} value={m.name}>
                {m.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {hasTime && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Time grain</span>
            <NativeSelect
              aria-label="Time grain"
              className="w-36"
              value={grain}
              onChange={(e) => setGrain(e.target.value)}
            >
              <NativeSelectOption value="">Default</NativeSelectOption>
              {DIMENSION_GRAINS.map((g) => (
                <NativeSelectOption key={g} value={g}>
                  {g}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        )}
        <Button disabled={!metric || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? <Loader2 className="animate-spin" /> : <Play />} Run
        </Button>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Split by</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {dimensions.map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={picked.includes(d.name)}
                onCheckedChange={(c) =>
                  setPicked((cur) => (c === true ? [...cur, d.name] : cur.filter((x) => x !== d.name)))
                }
              />
              {d.name}
            </label>
          ))}
          {!dimensions.length && (
            <p className="text-sm text-muted-foreground">No dimensions yet: the metric runs as one total.</p>
          )}
        </div>
      </fieldset>
      {run.error && (
        <p role="alert" className="text-sm text-destructive">
          {run.error.message}
        </p>
      )}
      {run.data && !run.data.success && run.data.error && (
        <p role="alert" className="text-sm text-destructive">
          {run.data.error}
        </p>
      )}
      {run.data?.success && (
        <>
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table aria-label="Result" className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="px-3 py-1.5 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  // Result rows have no key of their own.
                  // rows are positional
                  <tr key={i} className="border-t">
                    {columns.map((c) => (
                      <td key={c} className="px-3 py-1">
                        {cell(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td className="px-3 py-4 text-center text-muted-foreground">No rows.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {run.data.sql && (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">SQL it runs</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">
                {run.data.sql}
              </pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
