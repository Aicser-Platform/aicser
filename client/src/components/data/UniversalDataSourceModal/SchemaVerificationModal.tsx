'use client';

import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
    Modal,
    Steps,
    Card,
    Table,
    Button,
    Form,
    Input,
    Switch,
    Select,
    Tag,
    Alert,
    Space,
    Typography,
    Divider,
    Collapse,
    Tooltip,
    Progress,
    message,
    Row,
    Col,
} from 'antd';
import {
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    EditOutlined,
    EyeOutlined,
    DownloadOutlined,
    InfoCircleOutlined,
    WarningOutlined,
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const { Step } = Steps;
const { Option } = Select;
const { Panel } = Collapse;
const { TextArea } = Input;

interface SchemaVerificationModalProps {
    visible: boolean;
    dataSourceId: string;
    onClose: () => void;
    onSchemaVerified: (schema: any) => void;
}

interface VerificationData {
    data_source_id: string;
    schema: any;
    verification_checklist: any[];
    suggestions: any[];
    preview: any;
}

const SchemaVerificationModal: React.FC<SchemaVerificationModalProps> = ({
    visible,
    dataSourceId,
    onClose,
    onSchemaVerified,
}) => {
    const t = useTranslations('data_source_modal');
    const [currentStep, setCurrentStep] = useState(0);
    const [verificationData, setVerificationData] = useState<VerificationData | null>(null);
    const [loading, setLoading] = useState(false);
    const [verificationProgress, setVerificationProgress] = useState(0);
    const [userFeedback, setUserFeedback] = useState<any>({});
    const [editingTable, setEditingTable] = useState<string | null>(null);
    const [editingColumn, setEditingColumn] = useState<string | null>(null);

    useEffect(() => {
        if (visible && dataSourceId) {
            loadVerificationData();
        }
    }, [visible, dataSourceId]);

    const loadVerificationData = async () => {
        setLoading(true);
        try {
            const response = await fetch(`/api/data/schema/${dataSourceId}/verification`);
            const result = await response.json();
            
            if (result.success) {
                setVerificationData(result.verification_data);
            } else {
                message.error(`${t('load_verification_failed')}: ${result.error}`);
            }
        } catch (error) {
            message.error(t('load_verification_failed'));
            console.error('Error loading verification data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleVerificationComplete = async () => {
        setLoading(true);
        try {
            const response = await fetch(`/api/data/schema/${dataSourceId}/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    user_feedback: userFeedback,
                }),
            });

            const result = await response.json();
            
            if (result.success) {
                message.success(t('schema_verified_success'));
                onSchemaVerified(result.updated_schema);
                onClose();
            } else {
                message.error(`${t('schema_verification_failed')}: ${result.error}`);
            }
        } catch (error) {
            message.error(t('schema_verification_failed'));
            console.error('Error verifying schema:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleExportSchema = async (format: string) => {
        try {
            const response = await fetch(`/api/data/schema/${dataSourceId}/export?format=${format}`);
            const result = await response.json();
            
            if (result.success) {
                // Download the file
                const blob = new Blob([result.content], { type: result.content_type });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${dataSourceId}_schema.${format}`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
                
                message.success(t('schema_exported_as', { format: format.toUpperCase() }));
            } else {
                message.error(`${t('export_failed')}: ${result.error}`);
            }
        } catch (error) {
            message.error(t('export_failed'));
            console.error('Error exporting schema:', error);
        }
    };

    const updateUserFeedback = (category: string, item: string, value: any) => {
        setUserFeedback((prev: Record<string, any>) => ({
            ...prev,
            [category]: {
                ...(prev && prev[category] ? prev[category] : {}),
                [item]: value,
            },
        }));
    };

    const getStepStatus = (stepIndex: number) => {
        if (stepIndex < currentStep) return 'finish';
        if (stepIndex === currentStep) return 'process';
        return 'wait';
    };

    const renderSchemaOverview = () => {
        if (!verificationData) return null;

        const { preview } = verificationData;
        
        return (
            <div>
                <Alert
                    message={t('schema_overview')}
                    description={t('schema_overview_desc')}
                    type="info"
                    showIcon
                    style={{ marginBottom: 24 }}
                />

                <Row gutter={[16, 16]}>
                    <Col span={12}>
                        <Card title={t('data_source_information')} size="small">
                            <p><strong>{t('name')}:</strong> {preview.data_source.name}</p>
                            <p><strong>{t('type')}:</strong> {preview.data_source.type}</p>
                            <p><strong>{t('id')}:</strong> {preview.data_source.id}</p>
                        </Card>
                    </Col>
                    <Col span={12}>
                        <Card title={t('schema_statistics')} size="small">
                            <p><strong>{t('tables')}:</strong> {preview.summary.total_tables}</p>
                            <p><strong>{t('columns')}:</strong> {preview.summary.total_columns}</p>
                            <p><strong>{t('relationships')}:</strong> {preview.summary.total_relationships}</p>
                        </Card>
                    </Col>
                </Row>

                <Card title={t('cube_mapping_preview')} style={{ marginTop: 16 }}>
                    <Row gutter={[16, 16]}>
                        <Col span={8}>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '24px', color: '#52c41a' }}>
                                    {preview.summary.estimated_measures}
                                </div>
                                <Text type="secondary">{t('measures')}</Text>
                            </div>
                        </Col>
                        <Col span={8}>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '24px', color: '#1890ff' }}>
                                    {preview.summary.estimated_dimensions}
                                </div>
                                <Text type="secondary">{t('dimensions')}</Text>
                            </div>
                        </Col>
                        <Col span={8}>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '24px', color: '#722ed1' }}>
                                    {preview.summary.estimated_time_dimensions}
                                </div>
                                <Text type="secondary">{t('time_dimensions')}</Text>
                            </div>
                        </Col>
                    </Row>
                </Card>
            </div>
        );
    };

    const renderTableVerification = () => {
        if (!verificationData) return null;

        const { preview } = verificationData;
        
        const tableColumns = [
            {
                title: t('table_name'),
                dataIndex: 'name',
                key: 'name',
            },
            {
                title: t('columns'),
                dataIndex: 'columns_count',
                key: 'columns_count',
                render: (count: number) => <Tag color="blue">{count}</Tag>,
            },
            {
                title: t('rows'),
                dataIndex: 'row_count',
                key: 'row_count',
                render: (count: number) => count.toLocaleString(),
            },
            {
                title: t('actions'),
                key: 'actions',
                render: (_: any, record: any) => (
                    <Space>
                        <Button
                            size="small"
                            icon={<EyeOutlined />}
                            onClick={() => setEditingTable(record.name)}
                        >
                            {t('review')}
                        </Button>
                    </Space>
                ),
            },
        ];

        return (
            <div>
                <Alert
                    message={t('table_structure_verification')}
                    description={t('table_structure_verification_desc')}
                    type="info"
                    showIcon
                    style={{ marginBottom: 24 }}
                />

                <Table
                    columns={tableColumns}
                    dataSource={preview.tables_preview}
                    rowKey="name"
                    pagination={false}
                    size="small"
                />

                {editingTable && (
                    <Card
                        title={`${t('table')}: ${editingTable}`}
                        extra={
                            <Button onClick={() => setEditingTable(null)}>
                                {t('close')}
                            </Button>
                        }
                        style={{ marginTop: 16 }}
                    >
                        <Collapse>
                            <Panel header={t('column_details')} key="columns">
                                <Table
                                    columns={[
                                        {
                                            title: t('column'),
                                            dataIndex: 'name',
                                            key: 'name',
                                        },
                                        {
                                            title: t('type'),
                                            dataIndex: 'type',
                                            key: 'type',
                                        },
                                        {
                                            title: t('measure'),
                                            dataIndex: 'is_measure',
                                            key: 'is_measure',
                                            render: (isMeasure: boolean) => (
                                                <Tag color={isMeasure ? 'green' : 'default'}>
                                                    {isMeasure ? t('yes') : t('no')}
                                                </Tag>
                                            ),
                                        },
                                        {
                                            title: t('dimension'),
                                            dataIndex: 'is_dimension',
                                            key: 'is_dimension',
                                            render: (isDimension: boolean) => (
                                                <Tag color={isDimension ? 'blue' : 'default'}>
                                                    {isDimension ? t('yes') : t('no')}
                                                </Tag>
                                            ),
                                        },
                                        {
                                            title: t('time_dimension'),
                                            dataIndex: 'is_time_dimension',
                                            key: 'is_time_dimension',
                                            render: (isTimeDimension: boolean) => (
                                                <Tag color={isTimeDimension ? 'purple' : 'default'}>
                                                    {isTimeDimension ? t('yes') : t('no')}
                                                </Tag>
                                            ),
                                        },
                                    ]}
                                    dataSource={preview.tables_preview.find((t: any) => t.name === editingTable)?.sample_columns || []}
                                    pagination={false}
                                    size="small"
                                />
                            </Panel>
                        </Collapse>
                    </Card>
                )}
            </div>
        );
    };

    const renderVerificationChecklist = () => {
        if (!verificationData) return null;

        const { verification_checklist } = verificationData;
        
        return (
            <div>
                <Alert
                    message={t('verification_checklist')}
                    description={t('verification_checklist_desc')}
                    type="info"
                    showIcon
                    style={{ marginBottom: 24 }}
                />

                <Progress
                    percent={verificationProgress}
                    status={verificationProgress === 100 ? 'success' : 'active'}
                    style={{ marginBottom: 24 }}
                />

                {verification_checklist.map((category, categoryIndex) => (
                    <Card
                        key={categoryIndex}
                        title={category.category}
                        style={{ marginBottom: 16 }}
                    >
                        {category.items.map((item: any, itemIndex: number) => (
                            <div key={itemIndex} style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                                    <Text strong style={{ flex: 1 }}>
                                        {item.item}
                                    </Text>
                                    {item.required && (
                                        <Tag color="red">{t('required')}</Tag>
                                    )}
                                </div>
                                <Form.Item style={{ marginBottom: 0 }}>
                                    <Select
                                        placeholder={t('select_verification_status')}
                                        style={{ width: 200 }}
                                        onChange={(value) => {
                                            updateUserFeedback(category.category, item.item, value);
                                            // Update progress
                                            const totalItems = verification_checklist.reduce(
                                                (sum, cat) => sum + cat.items.length, 0
                                            );
                                            const completedItems = Object.values(userFeedback).reduce(
                                                (sum: number, cat: any) => sum + Object.keys(cat || {}).length, 0
                                            );
                                            setVerificationProgress((completedItems / totalItems) * 100);
                                        }}
                                    >
                                        <Option value="verified">
                                            <CheckCircleOutlined style={{ color: '#52c41a' }} /> {t('verified')}
                                        </Option>
                                        <Option value="needs_review">
                                            <ExclamationCircleOutlined style={{ color: '#faad14' }} /> {t('needs_review')}
                                        </Option>
                                        <Option value="incorrect">
                                            <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} /> {t('incorrect')}
                                        </Option>
                                    </Select>
                                </Form.Item>
                            </div>
                        ))}
                    </Card>
                ))}
            </div>
        );
    };

    const renderSuggestions = () => {
        if (!verificationData) return null;

        const { suggestions } = verificationData;
        
        return (
            <div>
                <Alert
                    message={t('schema_improvement_suggestions')}
                    description={t('schema_improvement_suggestions_desc')}
                    type="info"
                    showIcon
                    style={{ marginBottom: 24 }}
                />

                {suggestions.map((suggestion, index) => (
                    <Alert
                        key={index}
                        message={suggestion.message}
                        description={suggestion.suggestion}
                        type={suggestion.type === 'warning' ? 'warning' : 'info'}
                        showIcon
                        style={{ marginBottom: 16 }}
                        action={
                            <Button size="small" type="primary">
                                {t('apply_suggestion')}
                            </Button>
                        }
                    />
                ))}
            </div>
        );
    };

    const steps = [
        {
            title: t('schema_overview'),
            content: renderSchemaOverview(),
        },
        {
            title: t('table_verification'),
            content: renderTableVerification(),
        },
        {
            title: t('verification_checklist'),
            content: renderVerificationChecklist(),
        },
        {
            title: t('suggestions'),
            content: renderSuggestions(),
        },
    ];

    return (
        <Modal
            title={t('schema_verification_management')}
            open={visible}
            onCancel={onClose}
            width={1200}
            footer={[
                <Button key="export-yaml" icon={<DownloadOutlined />} onClick={() => handleExportSchema('yaml')}>
                    {t('export_yaml')}
                </Button>,
                <Button key="export-json" icon={<DownloadOutlined />} onClick={() => handleExportSchema('json')}>
                    {t('export_json')}
                </Button>,
                <Button key="export-cube" icon={<DownloadOutlined />} onClick={() => handleExportSchema('cube')}>
                    {t('export_cubejs')}
                </Button>,
                <Button key="cancel" onClick={onClose}>
                    {t('cancel')}
                </Button>,
                <Button
                    key="verify"
                    type="primary"
                    loading={loading}
                    disabled={verificationProgress < 100}
                    onClick={handleVerificationComplete}
                >
                    {t('verify_deploy_schema')}
                </Button>,
            ]}
        >
            <div style={{ marginBottom: 24 }}>
                <Steps current={currentStep} onChange={setCurrentStep}>
                    {steps.map((step, index) => (
                        <Step
                            key={index}
                            title={step.title}
                            status={getStepStatus(index)}
                        />
                    ))}
                </Steps>
            </div>

            <div style={{ minHeight: 400 }}>
                {steps[currentStep].content}
            </div>
        </Modal>
    );
};

export default SchemaVerificationModal;
