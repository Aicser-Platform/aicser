'use client';

import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
    Card,
    Row,
    Col,
    Typography,
    Alert,
    Tag,
    Progress,
    Button,
    Space,
    Tooltip,
    Divider,
} from 'antd';
import {
    ThunderboltOutlined,
    DatabaseOutlined,
    BarChartOutlined,
    RocketOutlined,
    CloudOutlined,
    CheckCircleOutlined,
} from '@ant-design/icons';
import { enhancedDataService } from '@/services/enhancedDataService';
import { QueryEngineIcon } from '@/utils/queryEngineIcon';

const { Title, Text, Paragraph } = Typography;

const MultiEngineQueryTab: React.FC = () => {
    const t = useTranslations('data_source_modal');
    const [availableEngines, setAvailableEngines] = useState<any[]>([]);
    const [healthStatus, setHealthStatus] = useState<Record<string, boolean>>({});

    useEffect(() => {
        loadQueryEngines();
        checkEngineHealth();
    }, []);

    const loadQueryEngines = async () => {
        try {
            const engines = enhancedDataService.getAvailableQueryEngines();
            setAvailableEngines(engines);
        } catch (error) {
            console.error('Failed to load query engines:', error);
        }
    };

    const checkEngineHealth = async () => {
        try {
            const result = await enhancedDataService.healthCheck();
            if (result.success && result.services) {
                setHealthStatus(result.services);
            }
        } catch (error) {
            console.error('Failed to check engine health:', error);
        }
    };

    const getEngineIcon = (type: string) => <QueryEngineIcon engine={type} style={{ fontSize: 24, marginRight: 0 }} />;

    const getEngineColor = (type: string) => {
        switch (type) {
            case 'duckdb':
                return '#1890ff';
            case 'cube':
                return '#722ed1';
            case 'spark':
                return '#fa8c16';
            case 'direct_sql':
                return '#52c41a';
            case 'pandas':
                return '#eb2f96';
            default:
                return '#666';
        }
    };

    const getEnginePerformance = (type: string) => {
        switch (type) {
            case 'duckdb':
                return { speed: 95, memory: 80, scalability: 70 };
            case 'cube':
                return { speed: 90, memory: 75, scalability: 95 };
            case 'spark':
                return { speed: 85, memory: 60, scalability: 100 };
            case 'direct_sql':
                return { speed: 80, memory: 90, scalability: 60 };
            case 'pandas':
                return { speed: 70, memory: 85, scalability: 40 };
            default:
                return { speed: 50, memory: 50, scalability: 50 };
        }
    };

    return (
        <div>
            <Alert
                message={t('multi_engine_title')}
                description={t('multi_engine_desc')}
                type="info"
                showIcon
                style={{ marginBottom: 24 }}
            />

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                {availableEngines.map((engine) => {
                    const performance = getEnginePerformance(engine.type);
                    const isHealthy = healthStatus[engine.type] !== false;
                    
                    return (
                        <Col xs={24} sm={12} md={8} key={engine.type}>
                            <Card
                                hoverable
                                style={{
                                    border: `1px solid ${getEngineColor(engine.type)}20`,
                                    borderLeft: `4px solid ${getEngineColor(engine.type)}`,
                                }}
                            >
                                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                                    <div style={{ fontSize: '32px', marginBottom: 8 }}>
                                        {getEngineIcon(engine.type)}
                                    </div>
                                    <Title level={5} style={{ margin: 0, color: getEngineColor(engine.type) }}>
                                        {engine.name}
                                    </Title>
                                    <Text type="secondary" style={{ fontSize: '12px' }}>
                                        {engine.description}
                                    </Text>
                                    <div style={{ marginTop: 8 }}>
                                        {isHealthy ? (
                                            <Tag color="success" icon={<CheckCircleOutlined />}>
                                                {t('healthy')}
                                            </Tag>
                                        ) : (
                                            <Tag color="warning">
                                                {t('checking')}
                                            </Tag>
                                        )}
                                    </div>
                                </div>

                                <Divider style={{ margin: '12px 0' }} />

                                <div style={{ marginBottom: 12 }}>
                                    <Text strong style={{ fontSize: '11px' }}>{t('performance')}</Text>
                                    <div style={{ marginTop: 8 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                            <Text style={{ fontSize: '10px' }}>{t('speed')}</Text>
                                            <Text style={{ fontSize: '10px' }}>{performance.speed}%</Text>
                                        </div>
                                        <Progress 
                                            percent={performance.speed} 
                                            size="small" 
                                            strokeColor={getEngineColor(engine.type)}
                                            showInfo={false}
                                        />
                                    </div>
                                    <div style={{ marginTop: 8 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                            <Text style={{ fontSize: '10px' }}>{t('memory_efficiency')}</Text>
                                            <Text style={{ fontSize: '10px' }}>{performance.memory}%</Text>
                                        </div>
                                        <Progress 
                                            percent={performance.memory} 
                                            size="small" 
                                            strokeColor={getEngineColor(engine.type)}
                                            showInfo={false}
                                        />
                                    </div>
                                    <div style={{ marginTop: 8 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                            <Text style={{ fontSize: '10px' }}>{t('scalability')}</Text>
                                            <Text style={{ fontSize: '10px' }}>{performance.scalability}%</Text>
                                        </div>
                                        <Progress 
                                            percent={performance.scalability} 
                                            size="small" 
                                            strokeColor={getEngineColor(engine.type)}
                                            showInfo={false}
                                        />
                                    </div>
                                </div>

                                <div style={{ marginTop: 12 }}>
                                    <Text strong style={{ fontSize: '11px' }}>{t('best_for')}</Text>
                                    <div style={{ marginTop: 6 }}>
                                        {engine.suitable_for.map((use: string) => (
                                            <Tag key={use} style={{ margin: '2px', fontSize: '9px' }}>
                                                {use}
                                            </Tag>
                                        ))}
                                    </div>
                                </div>
                            </Card>
                        </Col>
                    );
                })}
            </Row>

            <Card style={{ marginBottom: 16 }}>
                <Title level={4} style={{ marginBottom: 16 }}>
                    <ThunderboltOutlined style={{ marginRight: 8 }} />
                    {t('intelligent_engine_selection')}
                </Title>
                <Row gutter={[16, 16]}>
                    <Col span={12}>
                        <Card size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f' }}>
                            <Text strong>{t('automatic_selection')}</Text>
                            <Paragraph style={{ margin: '8px 0 0 0', fontSize: '12px' }}>
                                {t('automatic_selection_desc')}
                            </Paragraph>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card size="small" style={{ background: '#f0f5ff', border: '1px solid #adc6ff' }}>
                            <Text strong>{t('manual_override')}</Text>
                            <Paragraph style={{ margin: '8px 0 0 0', fontSize: '12px' }}>
                                {t('manual_override_desc')}
                            </Paragraph>
                        </Card>
                    </Col>
                </Row>
            </Card>

            <Alert
                message={t('query_engine_optimization')}
                description={
                    <div>
                        <Paragraph style={{ marginBottom: 8 }}>
                            <strong>{t('small_data_label')}</strong> {t('small_data_desc')}
                        </Paragraph>
                        <Paragraph style={{ marginBottom: 8 }}>
                            <strong>{t('medium_data_label')}</strong> {t('medium_data_desc')}
                        </Paragraph>
                        <Paragraph style={{ marginBottom: 8 }}>
                            <strong>{t('large_data_label')}</strong> {t('large_data_desc')}
                        </Paragraph>
                        <Paragraph style={{ marginBottom: 8 }}>
                            <strong>{t('bi_label')}</strong> {t('bi_desc')}
                        </Paragraph>
                        <Paragraph style={{ marginBottom: 0 }}>
                            <strong>{t('realtime_label')}</strong> {t('realtime_desc')}{' '}
                            {t('streams_ingestion_hint')}
                        </Paragraph>
                    </div>
                }
                type="success"
                showIcon
            />

            <div style={{ marginTop: 24, textAlign: 'center' }}>
                <Space>
                    <Button 
                        type="primary" 
                        icon={<RocketOutlined />}
                        onClick={() => { window.location.href = '/dashboards'; }}
                    >
                        {t('try_query_studio')}
                    </Button>
                    <Button 
                        icon={<BarChartOutlined />}
                        onClick={() => window.location.href = '/chat'}
                    >
                        {t('ai_powered_analysis')}
                    </Button>
                </Space>
            </div>
        </div>
    );
};

export default MultiEngineQueryTab;
