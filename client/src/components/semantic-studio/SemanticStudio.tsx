// One connection's semantic model (written for desktop on the server contract; web's Semantic Studio is EE client
// code): Metrics · Dimensions · Relationships · Questions · Try it, a model switcher and a link to the connection.
import { Link, useNavigate } from '@/lib/desktop/router';
import { ArrowLeft, Database } from 'lucide-react';
import { Button } from '@/components/aicser-ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { useDataSources } from '@/lib/desktop/dataSources';
import { useSemanticModel } from '@/hooks/useSemanticStudioModel';
import { useWorkspace } from '@/lib/desktop/workspace';
import { isModelEligible, type SemanticSection } from '@/lib/semantic/readiness';
import { cn } from '@/lib/ui/utils';
import { DimensionsSection } from './DimensionsSection';
import { MetricsSection } from './MetricsSection';
import { QuestionsSection } from './QuestionsSection';
import { RelationshipsSection } from './RelationshipsSection';
import { TryItSection } from './TryItSection';

export function SemanticStudio({ sourceId, section }: { sourceId: string; section: SemanticSection }) {
  const navigate = useNavigate();
  const { project } = useWorkspace();
  const projectId = project?.id ?? null;
  const sources = useDataSources(projectId);
  const model = useSemanticModel(sourceId);
  const eligible = (sources.data ?? []).filter((s) => isModelEligible(s.type));
  const current = (sources.data ?? []).find((s) => s.id === sourceId);
  const count = (n: number | undefined) => (n === undefined ? '' : ` (${n})`);

  const tabs: { key: SemanticSection; label: string }[] = [
    { key: 'metrics', label: `Metrics${count(model.metrics.data?.length)}` },
    { key: 'dimensions', label: `Dimensions${count(model.dimensions.data?.length)}` },
    { key: 'joins', label: `Relationships${count(model.relationships.data?.length)}` },
    { key: 'questions', label: 'Questions' },
    { key: 'try', label: 'Try it' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <Button asChild size="icon-sm" variant="ghost" aria-label="All semantic models" title="All semantic models">
          <Link to="/semantic-layer">
            <ArrowLeft />
          </Link>
        </Button>
        <NativeSelect
          aria-label="Model"
          className="w-60 font-semibold"
          value={sourceId}
          onChange={(e) =>
            void navigate({
              to: '/semantic-layer/sources/$sourceId',
              params: { sourceId: e.target.value },
              search: { section },
            })
          }
        >
          {!eligible.some((s) => s.id === sourceId) && (
            <NativeSelectOption value={sourceId}>{current?.name || sourceId}</NativeSelectOption>
          )}
          {eligible.map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>
              {s.name || s.id}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <nav aria-label="Model sections" className="flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
          {tabs.map((t) => (
            <Link
              key={t.key}
              to="/semantic-layer/sources/$sourceId"
              params={{ sourceId }}
              search={{ section: t.key }}
              aria-current={section === t.key ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground',
                section === t.key && 'bg-background font-medium text-foreground shadow-sm'
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <Button asChild size="sm" variant="outline" className="ml-auto">
          <Link to="/data/sources/$sourceId" params={{ sourceId }}>
            <Database /> Connection
          </Link>
        </Button>
      </header>
      {section === 'metrics' && <MetricsSection model={model} projectId={projectId} />}
      {section === 'dimensions' && <DimensionsSection model={model} projectId={projectId} />}
      {section === 'joins' && <RelationshipsSection model={model} />}
      {section === 'questions' && <QuestionsSection model={model} />}
      {section === 'try' && <TryItSection model={model} projectId={projectId} />}
    </div>
  );
}
