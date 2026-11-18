import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listDimensions, listMetrics, listQuestions, listRelationships } from '@/api/semanticStudio';
import { useDataSourceSchema } from '@/lib/desktop/dataSources';

/** Everything a connection's semantic model is made of; `refresh` reloads it after a change. */
export function useSemanticModel(dataSourceId: string) {
  const client = useQueryClient();
  const metrics = useQuery({
    queryKey: ['semantic', dataSourceId, 'metrics'],
    queryFn: () => listMetrics(dataSourceId),
  });
  const dimensions = useQuery({
    queryKey: ['semantic', dataSourceId, 'dimensions'],
    queryFn: () => listDimensions(dataSourceId),
  });
  const relationships = useQuery({
    queryKey: ['semantic', dataSourceId, 'relationships'],
    queryFn: () => listRelationships(dataSourceId),
  });
  const questions = useQuery({
    queryKey: ['semantic', dataSourceId, 'questions'],
    queryFn: () => listQuestions(dataSourceId),
  });
  const schema = useDataSourceSchema(dataSourceId);
  return {
    dataSourceId,
    metrics,
    dimensions,
    relationships,
    questions,
    tables: schema.data?.tables ?? [],
    schema,
    refresh: () => client.invalidateQueries({ queryKey: ['semantic'] }),
  };
}

export type SemanticModel = ReturnType<typeof useSemanticModel>;
