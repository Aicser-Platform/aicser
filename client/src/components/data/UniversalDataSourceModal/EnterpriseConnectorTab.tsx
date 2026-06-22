'use client';

import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
    Form,
    Input,
    Select,
    Button,
    message,
    Card,
    Row,
    Col,
    Typography,
    Alert,
    Space,
    Tag,
    Switch,
    InputNumber,
    Collapse,
    Tooltip,
} from 'antd';
import {
    CloudOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    ThunderboltOutlined,
    DatabaseOutlined,
} from '@ant-design/icons';
import { DataSourceIcon } from '@/utils/dataSourceIcons';
import { enhancedDataService, EnterpriseConnectionConfig } from '@/services/enhancedDataService';

const { Title, Text } = Typography;
const { Option } = Select;
const { Panel } = Collapse;

function connectorIconProps(connectorType: string): { type: string; dbType?: string } {
  const dbTypes = new Set(['postgresql', 'mysql', 'sqlserver', 'snowflake', 'bigquery', 'redshift', 'databricks']);
  if (dbTypes.has(connectorType)) return { type: 'database', dbType: connectorType };
  if (connectorType === 'rest_api' || connectorType === 'graphql_api') return { type: 'api' };
  return { type: 'database', dbType: connectorType };
}

function ConnectorTypeIcon({ connectorType, size = 24 }: { connectorType: string; size?: number }) {
  const props = connectorIconProps(connectorType);
  return <DataSourceIcon type={props.type} dbType={props.dbType} size={size} />;
}

interface EnterpriseConnectorTabProps {
    onConnectionCreated: (dataSource: any) => void;
}

const EnterpriseConnectorTab: React.FC<EnterpriseConnectorTabProps> = ({
    onConnectionCreated,
}) => {
    const t = useTranslations('data_source_modal');
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
    const [supportedConnectors, setSupportedConnectors] = useState<any[]>([]);

    useEffect(() => {
        loadSupportedConnectors();
    }, []);

    const loadSupportedConnectors = async () => {
        try {
            const connectors = enhancedDataService.getSupportedEnterpriseConnectors();
            setSupportedConnectors(connectors);
        } catch (error) {
            console.error('Failed to load supported connectors:', error);
        }
    };

    const handleTestConnection = async () => {
        const values = form.getFieldsValue();
        if (!values.type || !values.name) {
            message.error(t('required_fields'));
            return;
        }

        setTesting(true);
        setTestResult(null);

        try {
            const config: EnterpriseConnectionConfig = {
                type: values.type,
                name: values.name,
                host: values.host,
                port: values.port,
                database: values.database,
                username: values.username,
                password: values.password,
                token: values.token,
                api_key: values.api_key,
                connection_string: values.connection_string,
                ssl_enabled: values.ssl_enabled ?? true,
                timeout: values.timeout ?? 30,
                metadata: values.metadata,
            };

            const result = await enhancedDataService.testEnterpriseConnection(config);
            setTestResult(result);

            if (result.success) {
                message.success(t('connection_test_success'));
            } else {
                message.error(`${t('connection_test_failed')}: ${result.error}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Connection test failed';
            setTestResult({ success: false, error: errorMessage });
            message.error(errorMessage);
        } finally {
            setTesting(false);
        }
    };

    const handleCreateConnection = async () => {
        const values = form.getFieldsValue();
        
        if (!values.type || !values.name) {
            message.error(t('required_fields'));
            return;
        }

        setLoading(true);

        try {
            const config: EnterpriseConnectionConfig = {
                type: values.type,
                name: values.name,
                host: values.host,
                port: values.port,
                database: values.database,
                username: values.username,
                password: values.password,
                token: values.token,
                api_key: values.api_key,
                connection_string: values.connection_string,
                ssl_enabled: values.ssl_enabled ?? true,
                timeout: values.timeout ?? 30,
                metadata: values.metadata,
            };

            const result = await enhancedDataService.createEnterpriseConnection(config);

            if (result.success) {
                message.success(t('enterprise_connection_created'));
                onConnectionCreated({
                    id: result.connection_id,
                    name: values.name,
                    type: 'enterprise_connector',
                    status: 'connected',
                    created_at: new Date().toISOString(),
                });
                form.resetFields();
                setTestResult(null);
            } else {
                message.error(`${t('failed_create_connection')}: ${result.error}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to create connection';
            message.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const selectedConnector = supportedConnectors.find(c => c.type === form.getFieldValue('type'));

    return (
        <div>
            <Alert
                message={t('enterprise_data_connectors')}
                description={t('enterprise_data_connectors_desc')}
                type="info"
                showIcon
                style={{ marginBottom: 24 }}
            />

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                {supportedConnectors.map((connector) => (
                    <Col xs={24} sm={12} md={8} key={connector.type}>
                        <Card
                            hoverable
                            size="small"
                            style={{
                                border: form.getFieldValue('type') === connector.type ? '2px solid #1890ff' : '1px solid #d9d9d9',
                                cursor: 'pointer',
                            }}
                            onClick={() => form.setFieldsValue({ type: connector.type })}
                        >
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
                                  <ConnectorTypeIcon connectorType={connector.type} size={28} />
                                </div>
                                <Title level={5} style={{ margin: 0 }}>{connector.name}</Title>
                                <Text type="secondary" style={{ fontSize: '12px' }}>
                                    {connector.description}
                                </Text>
                            </div>
                        </Card>
                    </Col>
                ))}
            </Row>

            <Form
                form={form}
                layout="vertical"
                initialValues={{
                    ssl_enabled: true,
                    timeout: 30,
                }}
            >
                <Row gutter={16}>
                    <Col span={12}>
                        <Form.Item
                            name="type"
                            label={t('connector_type')}
                            rules={[{ required: true, message: t('select_connector_type') }]}
                        >
                            <Select placeholder={t('select_connector_type')} size="large">
                                {supportedConnectors.map((connector) => (
                                    <Option key={connector.type} value={connector.type}>
                                        <Space>
                                            <ConnectorTypeIcon connectorType={connector.type} size={16} />
                                            <span>{connector.name}</span>
                                        </Space>
                                    </Option>
                                ))}
                            </Select>
                        </Form.Item>
                    </Col>
                    <Col span={12}>
                        <Form.Item
                            name="name"
                            label={t('connection_name')}
                            rules={[{ required: true, message: t('enter_connection_name') }]}
                        >
                            <Input placeholder={t('connection_name_placeholder')} size="large" />
                        </Form.Item>
                    </Col>
                </Row>

                {selectedConnector && (
                    <Alert
                        message={`${selectedConnector.name} Configuration`}
                        description={selectedConnector.description}
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                    />
                )}

                <Collapse>
                    <Panel header={t('basic_configuration')} key="basic">
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item name="host" label={t('host')}>
                                    <Input placeholder={t('host_placeholder')} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="port" label={t('port')}>
                                    <InputNumber placeholder={t('port_placeholder')} style={{ width: '100%' }} />
                                </Form.Item>
                            </Col>
                        </Row>
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item name="database" label={t('database')}>
                                    <Input placeholder={t('database_placeholder')} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="username" label={t('username')}>
                                    <Input placeholder={t('username')} />
                                </Form.Item>
                            </Col>
                        </Row>
                        <Form.Item name="password" label={t('password')}>
                            <Input.Password placeholder={t('password')} />
                        </Form.Item>
                    </Panel>

                    <Panel header={t('advanced_configuration')} key="advanced">
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item name="token" label={t('token')}>
                                    <Input placeholder={t('token_placeholder')} />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="api_key" label={t('api_key')}>
                                    <Input placeholder={t('api_key')} />
                                </Form.Item>
                            </Col>
                        </Row>
                        <Form.Item name="connection_string" label={t('connection_string')}>
                            <Input.TextArea 
                                placeholder={t('connection_string_placeholder')}
                                rows={3}
                            />
                        </Form.Item>
                        <Row gutter={16}>
                            <Col span={12}>
                                <Form.Item name="ssl_enabled" label={t('ssl_enabled')} valuePropName="checked">
                                    <Switch />
                                </Form.Item>
                            </Col>
                            <Col span={12}>
                                <Form.Item name="timeout" label={t('timeout_seconds')}>
                                    <InputNumber min={5} max={300} style={{ width: '100%' }} />
                                </Form.Item>
                            </Col>
                        </Row>
                    </Panel>
                </Collapse>

                <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                        <Button
                            type="default"
                            icon={<ThunderboltOutlined />}
                            loading={testing}
                            onClick={handleTestConnection}
                        >
                            {t('test_connection')}
                        </Button>
                        {testResult && (
                            <Tag
                                color={testResult.success ? 'success' : 'error'}
                                icon={testResult.success ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
                            >
                                {testResult.success ? t('connection_successful') : t('connection_failed')}
                            </Tag>
                        )}
                    </Space>

                    <Button
                        type="primary"
                        loading={loading}
                        onClick={handleCreateConnection}
                        disabled={!testResult?.success}
                    >
                        {t('create_connection')}
                    </Button>
                </div>

                {testResult && !testResult.success && (
                    <Alert
                        message={t('connection_test_failed')}
                        description={testResult.error}
                        type="error"
                        showIcon
                        style={{ marginTop: 16 }}
                    />
                )}
            </Form>
        </div>
    );
};

export default EnterpriseConnectorTab;
