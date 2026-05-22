'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { 
    Card, 
    Button, 
    Space, 
    Input, 
    Table, 
    Alert, 
    message, 
    Spin,
    Typography,
    Divider,
    Row,
    Col,
    Tabs,
    Empty
} from 'antd';
import { 
    PlayCircleOutlined,
    BulbOutlined,
    CopyOutlined,
    DownloadOutlined,
    ExperimentOutlined,
    HistoryOutlined,
    BarChartOutlined,
    TableOutlined
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
const { TextArea } = Input;
const { Text, Title } = Typography;

interface SQLEditorProps {
    onQueryExecute?: (query: string, results: any) => void;
    defaultQuery?: string;
    dataSourceId?: string;
}

interface QueryHistory {
    id: string;
    query: string;
    timestamp: string;
    duration: number;
    rowCount: number;
    status: 'success' | 'error';
}

const SQLEditor: React.FC<SQLEditorProps> = ({
    onQueryExecute,
    defaultQuery = '',
    dataSourceId,
}) => {
    const t = useTranslations('sql_editor_legacy');
    const { session } = useAuthStore();
    const [query, setQuery] = useState(defaultQuery);
    const [results, setResults] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('result');
    const [queryHistory, setQueryHistory] = useState<QueryHistory[]>([]);
    const [chartData, setChartData] = useState<any>(null);
    const editorRef = useRef<any>(null);

    const executeQuery = async () => {
        if (!query.trim()) {
            message.warning(t('please_enter_sql'));
            return;
        }

        const startTime = Date.now();
        setLoading(true);
        setActiveTab('result');
        
        try {
            // Execute query through Cube.js
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            
            // Add Bearer token if available
            if (session?.access_token) {
                headers['Authorization'] = `Bearer ${session.access_token}`;
            }
            
            const response = await fetch('/api/data/cube/query', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    query: { sql: query }
                })
            });

            const result = await response.json();
            const duration = Date.now() - startTime;
            
            if (result.success) {
                setResults(result.data);
                
                // Generate chart data if applicable
                if (result.data && Array.isArray(result.data) && result.data.length > 0) {
                    generateChartData(result.data);
                }
                
                // Add to history
                const historyEntry: QueryHistory = {
                    id: Date.now().toString(),
                    query: query.trim(),
                    timestamp: new Date().toLocaleString(),
                    duration,
                    rowCount: result.data?.length || 0,
                    status: 'success'
                };
                setQueryHistory(prev => [historyEntry, ...prev.slice(0, 9)]); // Keep last 10
                
                message.success(t('query_success_duration', { duration }));
                onQueryExecute?.(query, result.data);
            } else {
                throw new Error(result.error || 'Query execution failed');
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            
            // Add error to history
            const historyEntry: QueryHistory = {
                id: Date.now().toString(),
                query: query.trim(),
                timestamp: new Date().toLocaleString(),
                duration,
                rowCount: 0,
                status: 'error'
            };
            setQueryHistory(prev => [historyEntry, ...prev.slice(0, 9)]);
            
            message.error(t('query_failed', { message: (error as Error).message }));
            setResults(null);
            setChartData(null);
        } finally {
            setLoading(false);
        }
    };

    const generateChartData = (data: any[]) => {
        if (!data || data.length === 0) return;
        
        const firstRow = data[0];
        const columns = Object.keys(firstRow);
        
        // Simple heuristic for chart generation
        const numericColumns = columns.filter(col => 
            typeof firstRow[col] === 'number'
        );
        const textColumns = columns.filter(col => 
            typeof firstRow[col] === 'string'
        );
        
        if (numericColumns.length > 0 && textColumns.length > 0) {
            const chartConfig = {
                type: 'bar',
                data: {
                    labels: data.map(row => row[textColumns[0]]).slice(0, 10),
                    datasets: [{
                        label: numericColumns[0],
                        data: data.map(row => row[numericColumns[0]]).slice(0, 10),
                        backgroundColor: 'rgba(24, 144, 255, 0.6)',
                        borderColor: 'rgba(24, 144, 255, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        title: {
                            display: true,
                            text: `${numericColumns[0]} by ${textColumns[0]}`
                        }
                    }
                }
            };
            setChartData(chartConfig);
        }
    };

    const generateSQLFromAI = async () => {
        if (!aiPrompt.trim()) {
            message.warning(t('enter_query_description'));
            return;
        }

        // Legacy SQL editor may not be attached to a concrete source. In that case,
        // keep behavior deterministic and local instead of calling backend with invalid IDs.
        if (!dataSourceId) {
            const basicSQL = generateBasicSQL(aiPrompt);
            setQuery(basicSQL);
            message.info(t('no_data_source_basic_sql'));
            setAiPrompt('');
            return;
        }

        setAiLoading(true);
        try {
            const response = await fetch('/api/ai/query-editor/generate-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: aiPrompt,
                    data_source_id: dataSourceId,
                    language: 'sql',
                })
            });

            const result = await response.json();
            
            if (result.success && result.code) {
                setQuery(result.code);
                message.success(t('ai_generated_sql'));
                setAiPrompt('');
            } else {
                // Fallback: generate a basic query structure
                const basicSQL = generateBasicSQL(aiPrompt);
                setQuery(basicSQL);
                message.info(t('generated_basic_sql'));
            }
        } catch (error) {
            message.error(t('ai_sql_failed', { message: (error as Error).message }));
        } finally {
            setAiLoading(false);
        }
    };

    const generateBasicSQL = (prompt: string): string => {
        const lowerPrompt = prompt.toLowerCase();
        
        if (lowerPrompt.includes('user') || lowerPrompt.includes('customer')) {
            return 'SELECT * FROM users LIMIT 10;';
        } else if (lowerPrompt.includes('chart') || lowerPrompt.includes('visualization')) {
            return 'SELECT * FROM charts LIMIT 10;';
        } else if (lowerPrompt.includes('conversation') || lowerPrompt.includes('chat')) {
            return 'SELECT * FROM conversations LIMIT 10;';
        } else {
            return 'SELECT * FROM your_table_name LIMIT 10;';
        }
    };

    const copyQuery = () => {
        navigator.clipboard.writeText(query);
        message.success(t('query_copied'));
    };

    const handleEditorDidMount = (editor: any, monaco: any) => {
        editorRef.current = editor;
        
        // Configure SQL language features
        monaco.languages.setLanguageConfiguration('sql', {
            comments: {
                lineComment: '--',
                blockComment: ['/*', '*/']
            },
            brackets: [
                ['{', '}'],
                ['[', ']'],
                ['(', ')']
            ],
            autoClosingPairs: [
                { open: '{', close: '}' },
                { open: '[', close: ']' },
                { open: '(', close: ')' },
                { open: '"', close: '"' },
                { open: "'", close: "'" }
            ],
            surroundingPairs: [
                { open: '{', close: '}' },
                { open: '[', close: ']' },
                { open: '(', close: ')' },
                { open: '"', close: '"' },
                { open: "'", close: "'" }
            ]
        });
    };

    const formatResults = () => {
        if (!results || !Array.isArray(results)) return [];
        
        return results.map((row, index) => ({
            key: index,
            ...row
        }));
    };

    const getColumns = () => {
        if (!results || !Array.isArray(results) || results.length === 0) return [];
        
        return Object.keys(results[0]).map(key => ({
            title: key,
            dataIndex: key,
            key: key,
            width: 150
        }));
    };

    return (
        <div style={{ padding: '16px' }}>
            <Title level={4}>
                <ExperimentOutlined /> {t('title')}
            </Title>
            
            {/* AI Prompt Section */}
            <Card 
                title={t('ai_sql_generation')}
                size="small" 
                style={{ marginBottom: 16 }}
            >
                <Row gutter={[16, 16]}>
                    <Col span={18}>
                        <Input
                            placeholder={t('prompt_placeholder')}
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            onPressEnter={generateSQLFromAI}
                        />
                    </Col>
                    <Col span={6}>
                        <Button 
                            type="primary" 
                            icon={<BulbOutlined />}
                            loading={aiLoading}
                            onClick={generateSQLFromAI}
                            block
                        >
                            {t('generate_sql')}
                        </Button>
                    </Col>
                </Row>
            </Card>

            {/* SQL Editor */}
            <Card 
                title={t('sql_query_editor')}
                extra={
                    <Space>
                        <Button 
                            icon={<CopyOutlined />} 
                            onClick={copyQuery}
                            disabled={!query}
                        >
                            {t('copy')}
                        </Button>
                        <Button 
                            type="primary" 
                            icon={<PlayCircleOutlined />}
                            loading={loading}
                            onClick={executeQuery}
                            disabled={!query.trim()}
                        >
                            {t('execute')}
                        </Button>
                    </Space>
                }
                style={{ marginBottom: 16 }}
                
            >
                <div style={{ height: '300px', border: '1px solid #d9d9d9', borderRadius: '6px' }}>
                    <TextArea
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('editor_placeholder')}
                        style={{ 
                            height: '300px',
                            fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                            fontSize: '14px',
                            border: 'none',
                            resize: 'none',
                            backgroundColor: '#fafafa'
                        }}
                    />
                </div>
            </Card>

            {/* Results Section with Tabs */}
            <Card>
                <Tabs
                    activeKey={activeTab}
                    onChange={setActiveTab}
                    items={[
                        {
                            key: 'result',
                            label: (
                                <span>
                                    <TableOutlined />
                                    Result {results && `(${results.length})`}
                                </span>
                            ),
                            children: (
                                <div>
                                    {loading && (
                                        <div style={{ textAlign: 'center', padding: '40px' }}>
                                            <Spin size="large" />
                                            <div style={{ marginTop: 16 }}>
                                                <Text>{t('executing_query')}</Text>
                                            </div>
                                        </div>
                                    )}

                                    {results && !loading && (
                                        <div>
                                            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <Text strong>{t('query_results_rows', { count: results.length })}</Text>
                                                <Button 
                                                    icon={<DownloadOutlined />}
                                                    onClick={() => {
                                                        const dataStr = JSON.stringify(results, null, 2);
                                                        const dataBlob = new Blob([dataStr], {type: 'application/json'});
                                                        const url = URL.createObjectURL(dataBlob);
                                                        const link = document.createElement('a');
                                                        link.href = url;
                                                        link.download = 'query_results.json';
                                                        link.click();
                                                    }}
                                                >
                                                    {t('export')}
                                                </Button>
                                            </div>
                                            <Table
                                                columns={getColumns()}
                                                dataSource={formatResults()}
                                                scroll={{ x: 'max-content', y: 400 }}
                                                pagination={{ 
                                                    pageSize: 50,
                                                    showSizeChanger: true,
                                                    showQuickJumper: true,
                                                    showTotal: (total, range) => 
                                                        t('range_of_items', { start: range[0], end: range[1], total })
                                                }}
                                                size="small"
                                            />
                                        </div>
                                    )}

                                    {!results && !loading && (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={t('no_query_results')}
                                        />
                                    )}
                                </div>
                            )
                        },
                        {
                            key: 'chart',
                            label: (
                                <span>
                                    <BarChartOutlined />
                                    {t('chart')}
                                </span>
                            ),
                            children: (
                                <div>
                                    {chartData ? (
                                        <div style={{ padding: '20px', textAlign: 'center' }}>
                                            <Alert
                                                message={t('chart_visualization')}
                                                description={t('chart_visualization_desc')}
                                                type="info"
                                                showIcon
                                                style={{ marginBottom: 16 }}
                                            />
                                            <div style={{ 
                                                height: '400px', 
                                                border: '1px solid #d9d9d9', 
                                                borderRadius: '6px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                backgroundColor: '#fafafa'
                                            }}>
                                                <Text type="secondary">{t('chart_placeholder')}</Text>
                                            </div>
                                        </div>
                                    ) : (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={t('no_chart_data')}
                                        />
                                    )}
                                </div>
                            )
                        },
                        {
                            key: 'history',
                            label: (
                                <span>
                                    <HistoryOutlined />
                                    {t('history_count', { count: queryHistory.length })}
                                </span>
                            ),
                            children: (
                                <div>
                                    {queryHistory.length > 0 ? (
                                        <Table
                                            columns={[
                                                {
                                                    title: t('timestamp'),
                                                    dataIndex: 'timestamp',
                                                    key: 'timestamp',
                                                    width: 150
                                                },
                                                {
                                                    title: t('query'),
                                                    dataIndex: 'query',
                                                    key: 'query',
                                                    render: (text: string) => (
                                                        <code style={{ 
                                                            fontSize: '12px',
                                                            backgroundColor: '#f5f5f5',
                                                            padding: '2px 4px',
                                                            borderRadius: '3px'
                                                        }}>
                                                            {text}
                                                        </code>
                                                    )
                                                },
                                                {
                                                    title: t('duration'),
                                                    dataIndex: 'duration',
                                                    key: 'duration',
                                                    width: 100,
                                                    render: (duration: number) => `${duration}ms`
                                                },
                                                {
                                                    title: t('rows'),
                                                    dataIndex: 'rowCount',
                                                    key: 'rowCount',
                                                    width: 80
                                                },
                                                {
                                                    title: t('status'),
                                                    dataIndex: 'status',
                                                    key: 'status',
                                                    width: 100,
                                                    render: (status: string) => (
                                                        <span style={{ 
                                                            color: status === 'success' ? '#52c41a' : '#ff4d4f',
                                                            fontWeight: 'bold'
                                                        }}>
                                                            {status?.toUpperCase() || t('unknown')}
                                                        </span>
                                                    )
                                                },
                                                {
                                                    title: t('actions'),
                                                    key: 'actions',
                                                    width: 100,
                                                    render: (_, record: QueryHistory) => (
                                                        <Button
                                                            size="small"
                                                            onClick={() => setQuery(record.query)}
                                                        >
                                                            {t('rerun')}
                                                        </Button>
                                                    )
                                                }
                                            ]}
                                            dataSource={queryHistory}
                                            rowKey="id"
                                            pagination={false}
                                            size="small"
                                        />
                                    ) : (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={t('no_query_history')}
                                        />
                                    )}
                                </div>
                            )
                        }
                    ]}
                />
            </Card>
        </div>
    );
};

export default SQLEditor;