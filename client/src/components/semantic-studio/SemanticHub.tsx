// Semantic models list (web SemanticLayerHub, written for desktop on `api/semantic/project-summary`): one row per
// connection that can hold a model, with its counts and next step. Not on desktop yet: business domains, the
// organization calendar, the connect-model-visualize wizard.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@/lib/desktop/router';
import { ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { projectSummary } from '@/api/semanticStudio';
import { DataTable } from '@/components/aicser-ui/data-table';
import type { DataTableColumn } from '@/components/aicser-ui/data-table';
import { PageTitle, QueryState } from '@/components/aicser-ui/page';
import { Tag, type Tone } from '@/components/prep/controls';
import { useDataSources } from '@/lib/desktop/dataSources';
import { useWorkspace } from '@/lib/desktop/workspace';
import {
  READINESS_LABEL,
  isModelEligible,
  isSingleTableSource,
  readinessOf,
  sectionFor,
  type SemanticReadiness,
} from '@/lib/semantic/readiness';

const READINESS_TONE: Record<SemanticReadiness, Tone> = {
  needs_relationships: 'warn',
  needs_metrics: 'warn',
  needs_certification: 'info',
  ready: 'good',
};

interface Row {
  id: string;
  name: string;
  type: string;
  metrics: number;
  dimensions: number;
  joins: number;
  readiness: SemanticReadiness;
}

const COLUMNS: DataTableColumn<Row>[] = [
  {
    id: 'name',
    header: 'Connection',
    cell: ({ row }) => (
      <Link
        to="/semantic-layer/sources/$sourceId"
        params={{ sourceId: row.original.id }}
        search={{ section: sectionFor(row.original.readiness) }}
        className="font-medium text-primary-active hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  { id: 'type', header: 'Type', cell: ({ row }) => <span className="text-muted-foreground">{row.original.type}</span> },
  { id: 'metrics', header: 'Metrics', cell: ({ row }) => row.original.metrics },
  { id: 'dimensions', header: 'Dimensions', cell: ({ row }) => row.original.dimensions },
  { id: 'joins', header: 'Relationships', cell: ({ row }) => row.original.joins },
  {
    id: 'readiness',
    header: 'Readiness',
    cell: ({ row }) => (
      <Tag tone={READINESS_TONE[row.original.readiness]}>{READINESS_LABEL[row.original.readiness]}</Tag>
    ),
  },
];

/** Connections of the selected project that can hold a semantic model, with how far each model is. */
export function SemanticHub() {
  const { project } = useWorkspace();
  const projectId = project?.id ?? null;
  const sources = useDataSources(projectId);
  const summary = useQuery({
    queryKey: ['semantic', 'summary', projectId],
    queryFn: () => projectSummary(projectId ?? ''),
    enabled: projectId !== null,
  });

  const rows = useMemo<Row[]>(() => {
    const counts = new Map((summary.data ?? []).map((s) => [s.data_source_id, s]));
    return (sources.data ?? [])
      .filter((s) => isModelEligible(s.type))
      .map((s) => {
        const c = counts.get(s.id);
        const ov = {
          metric_count: c?.metric_count ?? 0,
          join_count: c?.join_count ?? 0,
          certified_metric_count: c?.certified_metric_count ?? 0,
        };
        return {
          id: s.id,
          name: s.name || s.id,
          type: s.db_type || s.type || '',
          metrics: ov.metric_count,
          dimensions: c?.dimension_count ?? 0,
          joins: ov.join_count,
          readiness: readinessOf(ov, isSingleTableSource(s.type)),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sources.data, summary.data]);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        icon={<ShieldCheck className="size-5" aria-hidden="true" />}
        title="Semantic models"
        description="Business metrics, dimensions and how tables connect, per connection. Ask, dashboards and agents use these names, not raw columns."
      />
      {!projectId ? (
        <p className="text-sm text-muted-foreground">Choose a project in the header to see its models.</p>
      ) : (
        <QueryState query={summary} feature="Semantic models">
          {rows.length ? (
            <div className="rounded-xl border bg-card">
              <DataTable columns={COLUMNS} data={rows} />
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              {sources.data?.length
                ? 'None of this project’s connections can hold a model (database, warehouse, cube or file).'
                : 'No connections in this project yet. Add one in Connections, then define its metrics here.'}
            </p>
          )}
        </QueryState>
      )}
    </div>
  );
}
