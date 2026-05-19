import { fetchApi } from '@/utils/api';

export interface AgenticAnalysisRequest {
  query: string;
  data_source_id: string;
  analysis_depth?: 'basic' | 'intermediate' | 'advanced' | 'expert';
  include_recommendations?: boolean;
  include_action_items?: boolean;
  business_context?: string;
}

export interface UnifiedAIResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

class UnifiedAIService {
  async chatToChart(
    query: string,
    dataSourceId: string,
    options?: Record<string, unknown>
  ): Promise<UnifiedAIResult> {
    return fetchApi('charts/chat-to-chart', {
      method: 'POST',
      body: JSON.stringify({ query, data_source_id: dataSourceId, ...options }),
    });
  }

  async dataModelingWorkflow(
    dataSourceId: string,
    businessContext?: string,
    sampleData?: Record<string, unknown>[]
  ): Promise<UnifiedAIResult> {
    return fetchApi('charts/ai-data-modeling', {
      method: 'POST',
      body: JSON.stringify({
        data_source_id: dataSourceId,
        user_context: businessContext,
        sample_data: sampleData,
      }),
    });
  }

  async intelligentQueryAnalysis(params: {
    query: string;
    data_source_id?: string;
    business_context?: string;
  }): Promise<UnifiedAIResult> {
    return fetchApi('ai/query-analysis', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async performAgenticAnalysis(params: AgenticAnalysisRequest): Promise<UnifiedAIResult> {
    return fetchApi('ai/agentic-analysis', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async executeAgenticAnalysis(request: AgenticAnalysisRequest): Promise<any> {
    return fetchApi('ai/agentic-analysis', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async healthCheck(): Promise<UnifiedAIResult> {
    return fetchApi('ai/health');
  }

  async getMigrationStatus(): Promise<UnifiedAIResult> {
    return fetchApi('ai/migration-status');
  }
}

export const unifiedAIService = new UnifiedAIService();
