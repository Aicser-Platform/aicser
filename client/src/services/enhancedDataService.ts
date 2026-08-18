/**
 * Enhanced Data Service
 * Production-ready service for enterprise data connectivity and multi-engine query execution
 */

import { fetchApi } from '@/utils/api';
import { getBackendUrl } from '@/utils/backendUrl';

// Type definitions for enterprise data connectivity
export interface EnterpriseConnectionConfig {
    type: 'snowflake' | 'bigquery' | 'redshift' | 'databricks' | 'postgresql' | 'mysql' | 'sqlserver' | 'rest_api' | 'graphql_api';
    name: string;
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    token?: string;
    api_key?: string;
    connection_string?: string;
    ssl_enabled?: boolean;
    timeout?: number;
    metadata?: Record<string, any>;
}

export interface EnterpriseConnection {
    id: string;
    name: string;
    type: string;
    host?: string;
    database?: string;
    status: 'active' | 'inactive' | 'error';
    created_at: string;
    last_used?: string;
}

export interface QueryEngine {
    type: 'duckdb' | 'cube' | 'spark' | 'direct_sql' | 'pandas';
    name: string;
    description: string;
    suitable_for: string[];
}

export interface QueryResult {
    success: boolean;
    data: any[];
    columns: string[];
    row_count: number;
    execution_time: number;
    engine: string;
    query_id?: string;
    cached?: boolean;
    rls_applied?: boolean;
    error?: string;
    metadata?: Record<string, any>;
}

export interface DataSource {
    id: string;
    name: string;
    type: 'file' | 'database' | 'enterprise_connector';
    format?: string;
    status: 'connected' | 'disconnected' | 'error';
    row_count?: number;
    columns?: string[];
    size?: string;
    created_at: string;
    last_used?: string;
    metadata?: Record<string, any>;
}

export interface SchemaInfo {
    tables: Array<{
        name: string;
        schema?: string;
        columns: Array<{
            name: string;
            type: string;
            nullable: boolean;
            primary_key?: boolean;
            foreign_key?: string;
        }>;
        row_count: number;
        description?: string;
    }>;
    total_tables: number;
    database?: string;
}

class EnhancedDataService {
    private baseURL: string;
    private _enterpriseCache: { ts: number; connections: EnterpriseConnection[] } | null = null;

    constructor() {
        this.baseURL = getBackendUrl();
    }

    // ===== ENTERPRISE CONNECTIVITY =====

    /**
     * Test enterprise data source connection
     */
    async testEnterpriseConnection(config: EnterpriseConnectionConfig): Promise<{ success: boolean; error?: string; connection_info?: any }> {
        try {
            const response = await fetchApi('data/enterprise/connections/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(config),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Connection test failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Connection test failed',
            };
        }
    }

    /**
     * Create enterprise data source connection
     */
    async createEnterpriseConnection(config: EnterpriseConnectionConfig): Promise<{ success: boolean; connection_id?: string; error?: string }> {
        try {
            const response = await fetchApi('data/enterprise/connections', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(config),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Connection creation failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Connection creation failed',
            };
        }
    }

    /**
     * List all enterprise connections
     */
    async listEnterpriseConnections(): Promise<{ success: boolean; connections?: EnterpriseConnection[]; error?: string }> {
        try {
            // Simple in-memory cache valid for 30 seconds to reduce repeated calls
            const now = Date.now();
            if (this._enterpriseCache && (now - this._enterpriseCache.ts) < 30000) {
                return { success: true, connections: this._enterpriseCache.connections };
            }

            const response = await fetchApi('data/enterprise/connections');

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Failed to list connections: ${response.statusText}`);
            }

            const result = await response.json();
            // store into cache
            if (result && Array.isArray(result.connections)) {
                this._enterpriseCache = { ts: Date.now(), connections: result.connections };
            }
            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list connections',
            };
        }
    }

    /**
     * Execute query on enterprise connection
     */
    async executeEnterpriseQuery(connectionId: string, query: string, params?: Record<string, any>): Promise<QueryResult> {
        try {
            // fetchApi already parses JSON and throws on non-2xx responses
            const result = await fetchApi(`data/enterprise/connections/${connectionId}/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query, params }),
            });

            return {
                success: result.success,
                data: result.data || [],
                columns: result.columns || [],
                row_count: result.row_count || 0,
                execution_time: result.execution_time || 0,
                engine: 'enterprise',
                query_id: result.query_id,
                error: result.error,
            };
        } catch (error) {
            return {
                success: false,
                data: [],
                columns: [],
                row_count: 0,
                execution_time: 0,
                engine: 'enterprise',
                error: error instanceof Error ? error.message : 'Query execution failed',
            };
        }
    }

    /**
     * Get schema from enterprise connection
     */
    async getEnterpriseSchema(connectionId: string, tableName?: string): Promise<{ success: boolean; schema?: SchemaInfo; error?: string }> {
        try {
            const url = tableName 
                ? `data/enterprise/connections/${connectionId}/schema?table_name=${encodeURIComponent(tableName)}`
                : `data/enterprise/connections/${connectionId}/schema`;

            const response = await fetchApi(url);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Schema retrieval failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Schema retrieval failed',
            };
        }
    }

    // ===== MULTI-ENGINE QUERY EXECUTION =====

    /**
     * Execute query using optimal engine
     */
    async executeMultiEngineQuery(
        query: string,
        dataSourceId: string,
        engine?: string,
        optimization: boolean = true,
        signal?: AbortSignal,
        projectId?: string | number | null
    ): Promise<QueryResult> {
        try {
            // fetchApi already parses JSON and throws on non-2xx responses
            const result = await fetchApi('data/query/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query,
                    data_source_id: dataSourceId,
                    engine,
                    optimization,
                    project_id: projectId != null ? String(projectId) : undefined,
                }),
                signal,
            });

            return {
                success: result.success,
                data: result.data || [],
                columns: result.columns || [],
                row_count: result.row_count || 0,
                execution_time: result.execution_time || 0,
                engine: result.engine || engine || 'unknown',
                query_id: result.query_id,
                cached: result.cached,
                rls_applied: result.rls_applied,
                error: result.error,
                metadata: result.metadata,
            };
        } catch (error) {
            return {
                success: false,
                data: [],
                columns: [],
                row_count: 0,
                execution_time: 0,
                engine: engine || 'unknown',
                error: error instanceof Error ? error.message : 'Query execution failed',
            };
        }
    }

    /**
     * Execute multiple queries in parallel
     */
    async executeParallelQueries(
        queries: Array<{ query: string; engine?: string }>,
        dataSourceId: string
    ): Promise<{ success: boolean; results?: QueryResult[]; error?: string }> {
        try {
            const response = await fetchApi('data/query/parallel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    queries,
                    data_source_id: dataSourceId,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Parallel query execution failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Parallel query execution failed',
            };
        }
    }

    // ===== CUBE.JS INTEGRATION =====

    /**
     * Initialize Cube.js server
     */
    async initializeCubeServer(): Promise<{ success: boolean; message?: string; error?: string }> {
        try {
            const response = await fetchApi('data/cube/initialize', {
                method: 'POST',
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Cube.js initialization failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Cube.js initialization failed',
            };
        }
    }

    /**
     * Create Cube.js database connection
     */
    async createCubeConnection(config: Record<string, any>): Promise<{ success: boolean; connection_id?: string; error?: string }> {
        try {
            const response = await fetchApi('data/cube/connections', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(config),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Cube.js connection creation failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Cube.js connection creation failed',
            };
        }
    }

    /**
     * Execute query using Cube.js
     */
    async executeCubeQuery(connectionId: string, query: string, params?: Record<string, any>): Promise<QueryResult> {
        try {
            const response = await fetchApi(`data/cube/connections/${connectionId}/query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query, params }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Cube.js query execution failed: ${response.statusText}`);
            }

            const result = await response.json();
            return {
                success: result.success,
                data: result.data || [],
                columns: result.columns || [],
                row_count: result.row_count || 0,
                execution_time: result.execution_time || 0,
                engine: 'cube',
                query_id: result.query_id,
                error: result.error,
            };
        } catch (error) {
            return {
                success: false,
                data: [],
                columns: [],
                row_count: 0,
                execution_time: 0,
                engine: 'cube',
                error: error instanceof Error ? error.message : 'Cube.js query execution failed',
            };
        }
    }

    /**
     * Get Cube.js database schema
     */
    async getCubeSchema(connectionId: string): Promise<{ success: boolean; schema?: SchemaInfo; error?: string }> {
        try {
            const response = await fetchApi(`data/cube/connections/${connectionId}/schema`);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Cube.js schema retrieval failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Cube.js schema retrieval failed',
            };
        }
    }

    /**
     * Create Cube.js schema
     */
    async createCubeSchema(connectionId: string, schemaConfig: Record<string, any>): Promise<{ success: boolean; schema_file?: string; error?: string }> {
        try {
            const response = await fetchApi(`data/cube/connections/${connectionId}/schema`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ schema_config: schemaConfig }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Cube.js schema creation failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Cube.js schema creation failed',
            };
        }
    }

    // ===== LEGACY DATA SOURCES (for backward compatibility) =====

    /**
     * List all data sources (legacy + enterprise)
     */
    async listDataSources(): Promise<{ success: boolean; data_sources?: DataSource[]; error?: string }> {
        try {
            return await fetchApi('data/sources');
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list data sources',
            };
        }
    }

    /**
     * Get data source by ID
     */
    async getDataSource(dataSourceId: string): Promise<{ success: boolean; data_source?: DataSource; error?: string }> {
        try {
            return await fetchApi(`data/sources/${dataSourceId}`);
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get data source',
            };
        }
    }

    /**
     * Delete data source
     */
    async deleteDataSource(dataSourceId: string): Promise<{ success: boolean; message?: string; error?: string }> {
        try {
            return await fetchApi(`data/sources/${dataSourceId}`, {
                method: 'DELETE',
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete data source',
            };
        }
    }

    /**
     * Get data source schema
     */
    async getDataSourceSchema(dataSourceId: string): Promise<{ success: boolean; schema?: any; error?: string }> {
        try {
            return await fetchApi(`data/sources/${dataSourceId}/schema`);
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get schema',
            };
        }
    }

    /**
     * Update a data source (name, description, connection_config, is_active)
     */
    async updateDataSource(dataSourceId: string, updatePayload: any): Promise<{ success: boolean; data_source?: any; error?: string }> {
        try {
            // Using project-scoped API; defaults to org=1,proj=1 when context unknown
            const response = await fetchApi(`data/api/organizations/1/projects/1/data-sources/${dataSourceId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatePayload),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Update failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Update failed' };
        }
    }

    // ===== UTILITY METHODS =====

    /**
     * Get available query engines
     */
    getAvailableQueryEngines(): QueryEngine[] {
        return [
            {
                type: 'duckdb',
                name: 'DuckDB',
                description: 'Fast analytical database for medium-sized datasets',
                suitable_for: ['analytics', 'aggregations', 'joins'],
            },
            // {
            //     type: 'cube',
            //     name: 'Cube.js',
            //     description: 'OLAP engine for complex analytical queries',
            //     suitable_for: ['olap', 'pre-aggregations', 'business intelligence'],
            // },
            // {
            //     type: 'spark',
            //     name: 'Apache Spark',
            //     description: 'Big data processing engine for large datasets',
            //     suitable_for: ['big data', 'distributed processing', 'machine learning'],
            // },
            {
                type: 'direct_sql',
                name: 'Direct SQL',
                description: 'Direct database queries for real-time data',
                suitable_for: ['real-time', 'transactional', 'live data'],
            },
            // {
            //     type: 'pandas',
            //     name: 'Pandas',
            //     description: 'In-memory data processing for small datasets',
            //     suitable_for: ['small data', 'data transformation', 'prototyping'],
            // },
        ];
    }

    /**
     * Get supported enterprise connectors
     */
    getSupportedEnterpriseConnectors(): Array<{ type: string; name: string; description: string; icon: string }> {
        return [
            {
                type: 'snowflake',
                name: 'Snowflake',
                description: 'Cloud data warehouse for analytics',
                icon: '❄️',
            },
            {
                type: 'bigquery',
                name: 'Google BigQuery',
                description: 'Serverless data warehouse',
                icon: '🔍',
            },
            {
                type: 'redshift',
                name: 'Amazon Redshift',
                description: 'Cloud data warehouse',
                icon: '🔴',
            },
            {
                type: 'databricks',
                name: 'Databricks',
                description: 'Unified analytics platform',
                icon: '🔷',
            },
            {
                type: 'postgresql',
                name: 'PostgreSQL',
                description: 'Open source relational database',
                icon: '🐘',
            },
            {
                type: 'mysql',
                name: 'MySQL',
                description: 'Popular relational database',
                icon: '🐬',
            },
            {
                type: 'sqlserver',
                name: 'SQL Server',
                description: 'Microsoft relational database',
                icon: '🪟',
            },
            {
                type: 'rest_api',
                name: 'REST API',
                description: 'Connect to REST APIs',
                icon: '🌐',
            },
            {
                type: 'graphql_api',
                name: 'GraphQL API',
                description: 'Connect to GraphQL APIs',
                icon: '📊',
            },
        ];
    }

    /**
     * Health check for data services
     */
    async healthCheck(): Promise<{ success: boolean; services?: Record<string, any>; error?: string }> {
        try {
            const response = await fetchApi('data/health');

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Health check failed: ${response.statusText}`);
            }

            const result = await response.json();
            return result;
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Health check failed',
            };
        }
    }
}

// Export singleton instance
export const enhancedDataService = new EnhancedDataService();
export default enhancedDataService;
