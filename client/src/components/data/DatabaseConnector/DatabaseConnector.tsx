'use client';

import React, { useState } from 'react';
import { Form, Input, Select, Button, Card, Space, message, Spin, Radio, Divider } from 'antd';
import { DatabaseOutlined, ExperimentOutlined, LinkOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';

const { Option } = Select;

export interface DatabaseConnection {
    type: string;
    name: string;
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    schema?: string;
    uri?: string;
    connectionType?: 'manual' | 'uri';
}

interface DatabaseConnectorProps {
    onConnect: (connection: DatabaseConnection) => void;
    onTest: (connection: DatabaseConnection) => Promise<boolean>;
    loading?: boolean;
}

const DatabaseConnector: React.FC<DatabaseConnectorProps> = ({
    onConnect,
    onTest,
    loading = false
}) => {
    const t = useTranslations('database_connector');
    const [form] = Form.useForm();
    const [testing, setTesting] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [connectionType, setConnectionType] = useState<'manual' | 'uri'>('manual');

    const databaseTypes = [
        { value: 'postgresql', label: 'PostgreSQL', defaultPort: 5432 },
        { value: 'mysql', label: 'MySQL', defaultPort: 3306 },
        { value: 'sqlserver', label: 'SQL Server', defaultPort: 1433 },
        { value: 'snowflake', label: 'Snowflake', defaultPort: 443 },
        { value: 'bigquery', label: 'BigQuery', defaultPort: null },
        { value: 'redshift', label: 'Redshift', defaultPort: 5439 }
    ];

    const handleDatabaseTypeChange = (type: string) => {
        const dbType = databaseTypes.find(db => db.value === type);
        if (dbType && dbType.defaultPort) {
            form.setFieldsValue({ port: dbType.defaultPort });
        }
    };

    const parseConnectionUri = (uri: string) => {
        try {
            const url = new URL(uri);
            return {
                type: url.protocol.replace(':', ''),
                host: url.hostname,
                port: url.port ? parseInt(url.port) : undefined,
                database: url.pathname.replace('/', ''),
                username: url.username,
                password: url.password
            };
        } catch (error) {
            throw new Error(t('invalid_uri_format'));
        }
    };

    const handleTestConnection = async () => {
        try {
            const values = await form.validateFields();
            setTesting(true);
            
            let connection: DatabaseConnection;
            
            if (connectionType === 'uri') {
                const parsed = parseConnectionUri(values.uri);
                connection = {
                    ...parsed,
                    name: values.name || `${parsed.type}_${parsed.database}`,
                    uri: values.uri,
                    connectionType: 'uri'
                };
            } else {
                connection = {
                    type: values.type,
                    name: values.name || `${values.type}_${values.database}`,
                    host: values.host,
                    port: values.port,
                    database: values.database,
                    username: values.username,
                    password: values.password,
                    schema: values.schema,
                    connectionType: 'manual'
                };
            }

            const success = await onTest(connection);
            
            if (success) {
                message.success(t('connection_test_success'));
            } else {
                message.error(t('connection_test_failed'));
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('fill_required_fields'));
        } finally {
            setTesting(false);
        }
    };

    const handleConnect = async () => {
        try {
            const values = await form.validateFields();
            setConnecting(true);
            
            let connection: DatabaseConnection;
            
            if (connectionType === 'uri') {
                const parsed = parseConnectionUri(values.uri);
                connection = {
                    ...parsed,
                    name: values.name || `${parsed.type}_${parsed.database}`,
                    uri: values.uri,
                    connectionType: 'uri'
                };
            } else {
                connection = {
                    type: values.type,
                    name: values.name || `${values.type}_${values.database}`,
                    host: values.host,
                    port: values.port,
                    database: values.database,
                    username: values.username,
                    password: values.password,
                    schema: values.schema,
                    connectionType: 'manual'
                };
            }

            onConnect(connection);
            form.resetFields();
            message.success(t('connection_created_success'));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('fill_required_fields'));
        } finally {
            setConnecting(false);
        }
    };

    return (
        <Card 
            title={
                <Space>
                    <DatabaseOutlined />
                    {t('connect_database')}
                </Space>
            }
            size="small"
        >
            <Form
                form={form}
                layout="vertical"
                initialValues={{
                    type: 'postgresql',
                    port: 5432,
                    schema: 'public'
                }}
            >
                <Form.Item label={t('connection_method')}>
                    <Radio.Group 
                        value={connectionType} 
                        onChange={(e) => {
                            setConnectionType(e.target.value);
                            form.resetFields();
                        }}
                    >
                        <Radio value="manual">{t('manual_configuration')}</Radio>
                        <Radio value="uri">{t('connection_uri')}</Radio>
                    </Radio.Group>
                </Form.Item>

                <Form.Item
                    name="name"
                    label={t('connection_name')}
                >
                    <Input placeholder={t('optional_connection_name')} />
                </Form.Item>

                {connectionType === 'uri' ? (
                    <>
                        <Form.Item
                            name="uri"
                            label={t('connection_uri')}
                            rules={[{ required: true, message: t('please_enter_connection_uri') }]}
                        >
                            <Input.TextArea 
                                placeholder="postgres://username:password@host:port/database&#10;mysql://username:password@host:port/database&#10;postgresql://reader:NWDMCE5xdipIjRrp@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs"
                                rows={3}
                            />
                        </Form.Item>
                    </>
                ) : (
                    <>
                        <Form.Item
                            name="type"
                            label={t('database_type')}
                            rules={[{ required: true, message: t('please_select_database_type') }]}
                        >
                            <Select onChange={handleDatabaseTypeChange}>
                                {databaseTypes.map(db => (
                                    <Option key={db.value} value={db.value}>
                                        {db.label}
                                    </Option>
                                ))}
                            </Select>
                        </Form.Item>

                        <Form.Item
                            name="host"
                            label={t('host')}
                            rules={[{ required: true, message: t('please_enter_host') }]}
                        >
                            <Input placeholder={t('host_placeholder')} />
                        </Form.Item>

                        <Form.Item
                            name="port"
                            label={t('port')}
                            rules={[{ required: true, message: t('please_enter_port') }]}
                        >
                            <Input type="number" />
                        </Form.Item>

                        <Form.Item
                            name="database"
                            label={t('database_name')}
                            rules={[{ required: true, message: t('please_enter_database_name') }]}
                        >
                            <Input placeholder={t('database_name_placeholder')} />
                        </Form.Item>

                        <Form.Item
                            name="username"
                            label={t('username')}
                            rules={[{ required: true, message: t('please_enter_username') }]}
                        >
                            <Input placeholder={t('username_placeholder')} />
                        </Form.Item>

                        <Form.Item
                            name="password"
                            label={t('password')}
                            rules={[{ required: true, message: t('please_enter_password') }]}
                        >
                            <Input.Password placeholder={t('password_placeholder')} />
                        </Form.Item>

                        <Form.Item
                            name="schema"
                            label={t('schema_optional')}
                        >
                            <Input placeholder={t('schema_placeholder')} />
                        </Form.Item>
                    </>
                )}

                <Form.Item>
                    <Space>
                        <Button
                            icon={<ExperimentOutlined />}
                            onClick={handleTestConnection}
                            loading={testing}
                        >
                            {t('test_connection')}
                        </Button>
                        <Button
                            type="primary"
                            icon={<DatabaseOutlined />}
                            onClick={handleConnect}
                            loading={connecting || loading}
                        >
                            {t('connect')}
                        </Button>
                    </Space>
                </Form.Item>
            </Form>
        </Card>
    );
};

export default DatabaseConnector;