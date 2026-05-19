import { message } from 'antd';

export interface ChartDataSource {
    id: string;
    name: string;
    type: 'file' | 'database' | 'warehouse' | 'api' | 'cube';
    status: 'connected' | 'disconnected' | 'error';
    config: any;
    metadata?: any;
    lastUsed?: string;
    rowCount?: number;
    columns?: string[];
    size?: string;
    schema?: any;
}

export interface ChartDataQuery {
    dataSourceId: string;
    query: string;
    filters?: any[];
    sort?: any;
    limit?: number;
    offset?: number;
}

export interface ChartAggregation {
    field: string;
    type: 'sum' | 'avg' | 'count' | 'min' | 'max' | 'distinct';
    alias?: string;
}

export interface ChartDimension {
    field: string;
    type: 'categorical' | 'temporal' | 'numerical';
    format?: string;
    binning?: 'auto' | 'manual' | 'custom';
    binCount?: number;
}

export class ChartDataService {
    private static instance: ChartDataService;
    private dataSources: ChartDataSource[] = [];
    private currentDataSource: ChartDataSource | null = null;

    static getInstance(): ChartDataService {
        if (!ChartDataService.instance) {
            ChartDataService.instance = new ChartDataService();
        }
        return ChartDataService.instance;
    }

    async loadDataSources(): Promise<ChartDataSource[]> {
        try {
            const response = await fetch('/api/data/sources');
            if (response.ok) {
                const result = await response.json();
                this.dataSources = result.data_sources || [];
                return this.dataSources;
            } else {
                throw new Error('Failed to fetch data sources');
            }
        } catch (error) {
            console.error('Error loading data sources:', error);
            message.error('Failed to load data sources');
            return [];
        }
    }

    getDataSources(): ChartDataSource[] {
        return this.dataSources;
    }

    getDataSourceById(id: string): ChartDataSource | undefined {
        return this.dataSources.find(ds => ds.id === id);
    }

    setCurrentDataSource(dataSource: ChartDataSource | null): void {
        this.currentDataSource = dataSource;
    }

    getCurrentDataSource(): ChartDataSource | null {
        return this.currentDataSource;
    }
}

export default ChartDataService;
