import { API_URL } from '@/utils/api';

export async function fetchWithAuth(input: RequestInfo, init: RequestInit = {}) {
  const cfg = { ...(init || {}), credentials: 'include', headers: { ...(init.headers || {}) } } as RequestInit & { _retried?: boolean };
  const res = await fetch(input, cfg);
  if ((res.status === 401 || res.status === 403) && !cfg._retried) {
    // On unauthorized, redirect to login (no dev-only fallbacks)
    try {
      cfg._retried = true;
      // In browser, redirect user to login; otherwise return the original response
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    } catch (e) {
      // ignore and fall through
    }
  }
  return res;
}

import { fetchApi } from '@/utils/api';
import { unifiedAIService } from './unifiedAIService';
import { getBackendUrl } from '@/utils/backendUrl';

// Type definitions
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

export interface DataUploadResponse {
    file: {
        filename: string;
        content_type: string;
        storage_type: string;
        file_size: number;
        uuid_filename: string;
    };
    schema?: any;
    preview?: any[];
}

export interface DatabaseTestResponse {
    success: boolean;
    message: string;
    connection_info?: any;
}

export interface ChartGenerationRequest {
    data: any[];
    natural_language_query: string;
    query_analysis?: any;
    options?: any;
}

export interface ChartGenerationResponse {
    success: boolean;
    chart_type: string;
    chart_config: any;
    data_analysis: any;
    generation_metadata?: any;
    error?: string;
}

class ApiService {
    private baseURL: string;

    constructor() {
        this.baseURL = getBackendUrl();
    }

    // Data Upload API
    async uploadFile(file: File): Promise<ApiResponse<DataUploadResponse>> {
        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/data/upload', {
                method: 'POST',
                body: formData,
                credentials: 'include',
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                success: true,
                data: data,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Upload failed',
            };
        }
    }

    // Database Connection API
    async testDatabaseConnection(connection: any): Promise<ApiResponse<DatabaseTestResponse>> {
        try {
            const response = await fetchApi('data/database/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(connection),
            });

            if (!response.ok) {
                throw new Error(`Connection test failed: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                success: true,
                data: data,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Connection test failed',
            };
        }
    }

    async connectDatabase(connection: any): Promise<ApiResponse> {
        try {
            const response = await fetchApi('data/database/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(connection),
            });

            if (!response.ok) {
                throw new Error(`Database connection failed: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                success: true,
                data: data,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Database connection failed',
            };
        }
    }

    // Chart Generation API
    async generateChart(request: ChartGenerationRequest): Promise<ApiResponse<ChartGenerationResponse>> {
        try {
            const response = await fetchApi('api/v1/charts/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(request),
            });

            if (!response.ok) {
                throw new Error(`Chart generation failed: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                success: true,
                data: data,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Chart generation failed',
            };
        }
    }

    async generateMCPChart(request: any): Promise<ApiResponse> {
        try {
            const response = await fetchApi('api/v1/charts/mcp-chart', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(request),
            });

            if (!response.ok) {
                throw new Error(`MCP chart generation failed: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                success: true,
                data: data,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'MCP chart generation failed',
            };
        }
    }

    async getChartRecommendations(data: any[]): Promise<ApiResponse> {
        try {
            const response = await fetchApi('api/v1/charts/recommendations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ data }),
            });

            if (!response.ok) {
                throw new Error(`Chart recommendations failed: ${response.statusText}`);
            }

            const result = await response.json();
            return {
                success: true,
                data: result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Chart recommendations failed',
            };
        }
    }

    // File Management API
    async getFileList(offset = 0, limit = 100): Promise<ApiResponse> {
        try {
            const response = await fetchApi(`files/list?offset=${offset}&limit=${limit}`);

            if (!response.ok) {
                throw new Error(`Failed to fetch files: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                success: true,
                data: data,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch files',
            };
        }
    }

    async deleteFile(fileId: string): Promise<ApiResponse> {
        try {
            const response = await fetchApi(`files/${fileId}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                throw new Error(`Failed to delete file: ${response.statusText}`);
            }

            return {
                success: true,
                message: 'File deleted successfully',
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete file',
            };
        }
    }

    // Chat API
    async sendChatMessage(message: any): Promise<ApiResponse> {
        try {
            const response = await fetchApi('chats/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(message),
            });

            if (!response.ok) {
                throw new Error(`Chat failed: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                success: true,
                data: data,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Chat failed',
            };
        }
    }

    // Conversation API
    async getConversation(conversationId: string, limit = 10, offset = 0): Promise<ApiResponse> {
        try {
            const response = await fetchApi(
                `conversations/${conversationId}?limit=${limit}&offset=${offset}`
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch conversation: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                success: true,
                data: data,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch conversation',
            };
        }
    }

    // Health Check
    async healthCheck(): Promise<ApiResponse> {
        try {
            const response = await fetchApi('health');

            if (!response.ok) {
                throw new Error(`Health check failed: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                success: true,
                data: data,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Health check failed',
            };
        }
    }

    // ===== Unified AI Service Integration =====

    /**
     * Unified AI-powered chart generation using the consolidated service
     */
    async generateUnifiedAIChart(
        query: string,
        dataSourceId: string,
        options?: Record<string, any>
    ): Promise<ApiResponse> {
        try {
            const result = await unifiedAIService.chatToChart(query, dataSourceId, options);
            return {
                success: true,
                data: result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unified AI chart generation failed',
            };
        }
    }

    /**
     * AI-powered data modeling workflow
     */
    async performAIDataModeling(
        dataSourceId: string,
        businessContext?: string,
        sampleData?: Record<string, any>[]
    ): Promise<ApiResponse> {
        try {
            const result = await unifiedAIService.dataModelingWorkflow(dataSourceId, businessContext, sampleData);
            return {
                success: true,
                data: result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'AI data modeling failed',
            };
        }
    }

    /**
     * Intelligent query analysis using unified AI service
     */
    async analyzeQueryIntelligently(
        query: string,
        dataSourceId?: string,
        businessContext?: string
    ): Promise<ApiResponse> {
        try {
            const result = await unifiedAIService.intelligentQueryAnalysis({
                query,
                data_source_id: dataSourceId,
                business_context: businessContext,
            });
            return {
                success: true,
                data: result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Intelligent query analysis failed',
            };
        }
    }

    /**
     * Advanced agentic analysis
     */
    async performAgenticAnalysis(
        query: string,
        dataSourceId: string,
        analysisDepth: 'basic' | 'intermediate' | 'advanced' | 'expert' = 'advanced',
        includeRecommendations: boolean = true,
        includeActionItems: boolean = true,
        businessContext?: string
    ): Promise<ApiResponse> {
        try {
            const result = await unifiedAIService.performAgenticAnalysis({
                query,
                data_source_id: dataSourceId,
                analysis_depth: analysisDepth,
                include_recommendations: includeRecommendations,
                include_action_items: includeActionItems,
                business_context: businessContext,
            });
            return {
                success: true,
                data: result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Agentic analysis failed',
            };
        }
    }

    /**
     * AI health check
     */
    async aiHealthCheck(): Promise<ApiResponse> {
        try {
            const result = await unifiedAIService.healthCheck();
            return {
                success: true,
                data: result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'AI health check failed',
            };
        }
    }

    /**
     * Get AI migration status
     */
    async getAIMigrationStatus(): Promise<ApiResponse> {
        try {
            const result = await unifiedAIService.getMigrationStatus();
            return {
                success: true,
                data: result,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get AI migration status',
            };
        }
    }
}

// Export singleton instance
export const apiService = new ApiService();
export default apiService;