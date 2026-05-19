'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import nextDynamic from 'next/dynamic';
import {
    Card,
    Button,
    Table,
    Space,
    Tag,
    Modal,
    message,
    Row,
    Col,
    Statistic,
    Typography,
    Divider,
    Tooltip,
    Input,
    Segmented,
    Empty,
    Alert,
    Progress,
} from 'antd';
import {
    PlusOutlined,
    DatabaseOutlined,
    EditOutlined,
    DeleteOutlined,
    ReloadOutlined,
    SearchOutlined,
    ArrowUpOutlined,
} from '@ant-design/icons';

const UniversalDataSourceModal = nextDynamic(
    () => import('@/components/data/UniversalDataSourceModal/UniversalDataSourceModal').then((m) => m.default),
    { ssr: false }
);
import { usePlanRestrictions } from '@/hooks/usePlanRestrictions';
import { usePermissions, Permission } from '@/hooks/usePermissions';
import { PermissionGuard } from '@/components/PermissionGuard';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
const PricingModal = nextDynamic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (() => import('@/ee').then((m) => ({ default: m.PricingModalEE }))) as any,
  { ssr: false }
) as React.ComponentType<{ visible?: boolean; onClose?: () => void; onUpgrade?: (planType: string, isYearly: boolean) => void; currentPlan?: string; loading?: boolean }>;
import { type DataSource } from '@/stores/useDataSourceStore';
import { useDataSources, useDeleteDataSource } from '@/hooks/useDataSources';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';
import { useSubscriptionStore as useSubscription } from '@/stores/useSubscriptionStore';
import { DataSourceIcon } from '@/utils/dataSourceIcons';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

const { Title, Text } = Typography;

const isSampleDataSource = (ds: { type?: string | null }) =>
    (ds.type || '').toLowerCase() === 'sample_duckdb';

// interface DataSource {
//     id: string;
//     name: string;
//     type: 'file' | 'database' | 'warehouse' | 'api' | 'cube';
//     connection_status?: 'connected' | 'disconnected' | 'error' | 'testing';
//     connection_info?: any;
//     lastUsed?: string;
//     rowCount?: number;
//     columns?: any[];
//     size?: string;
//     description?: string;
// }

const DataSourcesPage: React.FC = () => {
    const t = useTranslations('data_page');
    const { usage } = useSubscription();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedDataSource, setSelectedDataSource] = useState<DataSource | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | DataSource['connection_status']>('all');
    const [typeFilter, setTypeFilter] = useState<'all' | DataSource['type']>('all');
    const [pricingModalVisible, setPricingModalVisible] = useState(false);
    const { dataSources, isLoading } = useDataSources();
    const { mutateAsync: deleteDataSource } = useDeleteDataSource();
    const qc = useQueryClient();
    const refreshDataSources = () => qc.invalidateQueries({ queryKey: ['data-sources'] });
    const authenticatedFetch = useAuthenticatedFetch();

    // Open edit modal when navigating from settings with ?edit=<id>
    const openedEditIdRef = React.useRef<string | null>(null);
    const editId = searchParams?.get('edit');
    useEffect(() => {
        if (!editId || dataSources.length === 0) return;
        if (openedEditIdRef.current === editId) return;
        const ds = dataSources.find((d) => d.id === editId);
        if (ds) {
            openedEditIdRef.current = editId;
            handleEditDataSource(ds).finally(() => router.replace('/data', { scroll: false }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when editId or data list length changes
    }, [editId, dataSources.length]);

    // Debug: Log when data sources change
    useEffect(() => {
        console.log('📊 Data sources updated:', dataSources.length, 'sources');
        console.log('Data sources:', dataSources);
    }, [dataSources]);

    
    const handleAddDataSource = () => {
        if (!canAddDataSource) {
            Modal.warning({
                title: t('limit_reached_title'),
                content: t('limit_reached_content', { used: dataSourcesUsedCount, limit: dataSourcesLimit }),
                okText: t('upgrade_plan'),
                onOk: () => { window.dispatchEvent(new CustomEvent('open-pricing-modal')); },
            });
            return;
        }
        setSelectedDataSource(null);
        setModalVisible(true);
    };

    const handleEditDataSource = async (dataSource: DataSource) => {
        try {
            // authenticatedFetch (fetchApi) returns parsed JSON on success, throws on 4xx/5xx
            const data = await authenticatedFetch(`/api/data/sources/${dataSource.id}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            const full = data?.data_source ? { ...dataSource, ...data.data_source } : dataSource;
            setSelectedDataSource(full);
            setModalVisible(true);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : t('load_connection_failed');
            message.error(msg.includes('API Error') ? msg : `${t('load_connection_failed')}: ${msg}`);
        }
    };

    const handleModalClose = () => {
        setModalVisible(false);
        setSelectedDataSource(null);
        refreshDataSources();
    };

    const handleDeleteDataSource = async (dataSource: DataSource) => {
        Modal.confirm({
            title: t('delete_data_source'),
            content: t('delete_confirm_content', { name: dataSource.name }),
            okText: t('delete'),
            okType: 'danger',
            cancelText: t('cancel'),
            onOk: async () => {
                try {
                    await deleteDataSource(dataSource.id);
                    message.success(t('deleted_success'));
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : t('delete_failed');
                    message.error(errorMessage);
                    console.error('Error deleting data source:', error);
                }
            },
        });
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'connected':
                return 'success';
            case 'disconnected':
                return 'default';
            case 'error':
                return 'error';
            case 'testing':
                return 'processing';
            default:
                return 'default';
        }
    };

    const columns = [
        {
            title: t('col_name'),
            dataIndex: 'name',
            key: 'name',
            render: (text: string, record: DataSource) => (
                <Space>
                    <DataSourceIcon type={record.type} dbType={record.db_type} size={18} style={{ opacity: 0.9 }} />
                    <Text strong>{text}</Text>
                </Space>
            ),
        },
        {
            title: t('col_type'),
            dataIndex: 'type',
            key: 'type',
            render: (type: string) => (
                <Tag color="blue">{type.toUpperCase()}</Tag>
            ),
        },
        {
            title: t('col_status'),
            dataIndex: 'connection_status',
            key: 'connection_status',
            render: (status: string) => (
                <Tag color={getStatusColor(status)}>
                    {status ? status.toUpperCase() : t('unknown')}
                </Tag>
            ),
        },
        {
            title: t('col_rows'),
            dataIndex: 'row_count',
            key: 'row_count',
            render: (count: number) => count ? count.toLocaleString() : '-',
        },
        {
            title: t('col_size'),
            dataIndex: 'size',
            key: 'size',
            render: (size: number) => size ? `${(size / 1024).toFixed(2)} KB` : '-',
        },
        {
            title: t('col_last_used'),
            dataIndex: 'last_accessed',
            key: 'last_accessed',
            render: (date: string) => date ? new Date(date).toLocaleDateString() : '-',
        },
        {
            title: t('col_actions'),
            key: 'actions',
            render: (_: any, record: DataSource) => (
                <Space>
                    <Tooltip title={t('edit_connection')}>
                        <Button
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => handleEditDataSource(record)}
                        />
                    </Tooltip>
                    <Tooltip title={t('delete')}>
                        <Button
                            size="small"
                            icon={<DeleteOutlined />}
                            danger
                            onClick={() => handleDeleteDataSource(record)}
                        />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    const filteredDataSources = useMemo(() => {
        return dataSources.filter((ds) => {
            const matchesSearch = ds.name.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = statusFilter === 'all' || ds.connection_status === statusFilter;
            const matchesType = typeFilter === 'all' || ds.type === typeFilter;
            return matchesSearch && matchesStatus && matchesType;
        });
    }, [dataSources, searchTerm, statusFilter, typeFilter]);

    const planCountableDataSources = useMemo(
        () => dataSources.filter((ds) => !isSampleDataSource(ds)),
        [dataSources],
    );

    const stats = {
        total: dataSources.length,
        connected: dataSources.filter(ds => ds.connection_status === 'connected').length,
        databases: dataSources.filter(ds => ds.type === 'database').length,
        files: dataSources.filter(ds => ds.type === 'file').length,
        apis: dataSources.filter(ds => ds.type === 'api').length,
        warehouses: dataSources.filter(ds => ds.type === 'warehouse' || ds.type === 'cube').length,
    };

    // Use real subscription limits from SubscriptionContext
    const dsUsage = usage?.data_sources_count;
    const dataSourcesLimit = dsUsage ? (dsUsage.unlimited ? -1 : (dsUsage.limit ?? -1)) : -1;
    const dataSourcesUsedCount = dsUsage ? (dsUsage.used ?? planCountableDataSources.length) : planCountableDataSources.length;
    const dataSourcesPercent = dsUsage ? (dsUsage.percentage ?? 0) : 0;
    const canAddDataSource = dataSourcesLimit < 0 || dataSourcesUsedCount < dataSourcesLimit;

    // Activity inbox / deep links: /data?openDataSource=1 opens the add-data-source modal (same as Connect)
    const openDataSourceParam = searchParams?.get('openDataSource');
    const openedDataSourceFromQueryRef = React.useRef(false);
    useEffect(() => {
        if (openDataSourceParam !== '1') {
            openedDataSourceFromQueryRef.current = false;
            return;
        }
        if (isLoading) return;
        if (openedDataSourceFromQueryRef.current) return;
        openedDataSourceFromQueryRef.current = true;

        if (!canAddDataSource) {
            Modal.warning({
                title: t('limit_reached_title'),
                content: t('limit_reached_content', { used: dataSourcesUsedCount, limit: dataSourcesLimit }),
                okText: t('upgrade_plan'),
                onOk: () => {
                    window.dispatchEvent(new CustomEvent('open-pricing-modal'));
                },
            });
            router.replace('/data', { scroll: false });
            return;
        }
        setSelectedDataSource(null);
        setModalVisible(true);
        router.replace('/data', { scroll: false });
    }, [
        openDataSourceParam,
        isLoading,
        canAddDataSource,
        dataSourcesUsedCount,
        dataSourcesLimit,
        t,
        router,
    ]);

    return (
        <div
            className="page-wrapper"
            style={{
                paddingLeft: '16px',
                paddingRight: '16px',
                paddingTop: '16px',
                paddingBottom: '24px',
                background: 'var(--ant-color-bg-layout)',
            }}
        >
            <div className="page-header" style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                    <Title level={2} className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 0 }}>
                        <DatabaseOutlined style={{ color: 'var(--ant-color-primary, var(--ant-primary-color))', fontSize: '24px' }} />
                        {t('title')}
                    </Title>
                    <PermissionGuard permission={Permission.DATA_EDIT}>
                        <Tooltip
                            title={
                                canAddDataSource
                                    ? t('connect_new_tooltip')
                                    : t('reached_plan_limit', { limit: dataSourcesLimit > -1 ? dataSourcesLimit : 1 })
                            }
                        >
                            <Button
                                icon={<PlusOutlined />}
                                onClick={handleAddDataSource}
                                disabled={!canAddDataSource}
                            >
                                {t('connect_data_source')}
                            </Button>
                        </Tooltip>
                    </PermissionGuard>
                </div>
                <Text type="secondary" className="page-description" style={{ marginTop: '4px', marginBottom: '0' }}>
                    {t('description')}
                </Text>
            </div>
            <div className="page-body">
            {/* Statistics & quick actions */}
            <Row gutter={[24, 24]} style={{ marginBottom: '24px' }}>
                <Col xs={24} lg={6}>
                    <Card className="stat-card" style={{ background: 'var(--ant-color-bg-container)' }} bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Statistic title={t('stat_total_sources')} value={stats.total} prefix={<DatabaseOutlined />} />
                        <Text type="secondary">{t('stat_in_project')}</Text>
                    </Card>
                </Col>
                <Col xs={24} lg={6}>
                    <Card className="stat-card" style={{ background: 'var(--ant-color-bg-container)' }}>
                        <Statistic title={t('stat_connected')} value={stats.connected} valueStyle={{ color: 'var(--ant-color-success)' }} />
                        <Text type="secondary">{t('stat_healthy_connections')}</Text>
                    </Card>
                </Col>
                <Col xs={24} lg={6}>
                    <Card className="stat-card" style={{ background: 'var(--ant-color-bg-container)' }}>
                        <Statistic title={t('stat_databases')} value={stats.databases} />
                        <Text type="secondary">{t('stat_sql_transactional')}</Text>
                    </Card>
                </Col>
                <Col xs={24} lg={6}>
                    <Card className="stat-card" style={{ background: 'var(--ant-color-bg-container)' }}>
                        <Statistic title={t('stat_files_apis')} value={stats.files + stats.apis} />
                        <Text type="secondary">{t('stat_flat_files_services')}</Text>
                    </Card>
                </Col>
            </Row>

            <Card className="content-card" style={{ marginTop: 24, marginBottom: 24, background: 'var(--ant-color-bg-container)' }}>
                <Row gutter={[16, 16]} align="middle">
                    <Col xs={24} md={18}>
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                            <Text type="secondary">{t('plan_quota')}</Text>
                            <Progress
                                percent={dataSourcesPercent}
                                status={dataSourcesPercent >= 90 ? 'exception' : 'active'}
                                strokeColor={dataSourcesPercent >= 90 ? '#ff7875' : 'var(--ant-color-primary)'}
                                format={() =>
                                    dataSourcesLimit < 0
                                        ? t('connected_org_count', { count: dataSourcesUsedCount })
                                        : t('used_limit', { used: dataSourcesUsedCount, limit: dataSourcesLimit })
                                }
                            />
                            <Text>
                                {dataSourcesLimit < 0
                                    ? t('unlimited_connections')
                                    : t('connections_remaining', { count: Math.max(dataSourcesLimit - dataSourcesUsedCount, 0) })}
                            </Text>
                        </Space>
                    </Col>
                    <Col xs={24} md={6} style={{ textAlign: 'right' }}>
                        <Button
                            icon={<ArrowUpOutlined />}
                            onClick={() => setPricingModalVisible(true)}
                            block
                        >
                            {t('view_plans')}
                        </Button>
                    </Col>
                </Row>
                {!canAddDataSource && (
                    <Alert
                        type="warning"
                        showIcon
                        style={{ marginTop: 16 }}
                        message={t('limit_alert')}
                    />
                )}
            </Card>

            <Card className="content-card" style={{ marginTop: 24, background: 'var(--ant-color-bg-container)' }}>
                <div className="page-toolbar" style={{ flexWrap: 'wrap', gap: 12, flexDirection: 'column', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                        <Space size={12} wrap>
                            <PermissionGuard permission={Permission.DATA_EDIT}>
                                <Tooltip
                                    title={
                                        canAddDataSource
                                            ? t('connect_new_tooltip')
                                            : t('reached_plan_limit', { limit: dataSourcesLimit > -1 ? dataSourcesLimit : 1 })
                                    }
                                >
                                    <Button
                                        type="primary"
                                        icon={<PlusOutlined />}
                                        onClick={handleAddDataSource}
                                        disabled={!canAddDataSource}
                                    >
                                        {t('add_data_source')}
                                    </Button>
                                </Tooltip>
                            </PermissionGuard>
                            <Button 
                                icon={<ReloadOutlined />} 
                                onClick={() => refreshDataSources()}
                                loading={isLoading}
                            >
                                {t('refresh')}
                            </Button>
                        </Space>
                        <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder={t('search_sources')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ minWidth: 160, maxWidth: 220, flex: '1 1 160px' }}
                        />
                    </div>
                    <Space size={12} wrap style={{ marginTop: 4 }}>
                        <Segmented
                            value={statusFilter}
                            onChange={(value) => setStatusFilter(value as typeof statusFilter)}
                            size="small"
                            options={[
                                { label: t('filter_all_statuses'), value: 'all' },
                                { label: t('filter_connected'), value: 'connected' },
                                { label: t('filter_disconnected'), value: 'disconnected' },
                                { label: t('filter_error'), value: 'error' },
                            ]}
                        />
                        <Segmented
                            value={typeFilter}
                            onChange={(value) => setTypeFilter(value as typeof typeFilter)}
                            size="small"
                            options={[
                                { label: t('filter_all_types'), value: 'all' },
                                { label: t('filter_databases'), value: 'database' },
                                { label: t('filter_files'), value: 'file' },
                                { label: t('filter_apis'), value: 'api' },
                            ]}
                        />
                    </Space>
                </div>
                <Divider className="page-divider" />
                <div style={{ minHeight: '50vh' }}>
                    <Table
                        className="data-table"
                        columns={columns}
                        dataSource={filteredDataSources}
                        rowKey="id"
                        loading={isLoading}
                        locale={{
                            emptyText: (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description={
                                        searchTerm || statusFilter !== 'all' || typeFilter !== 'all'
                                            ? t('empty_filtered')
                                            : t('empty_none')
                                    }
                                />
                            ),
                        }}
                        pagination={{
                            pageSize: 10,
                            showSizeChanger: true,
                            showQuickJumper: true,
                            showTotal: (total, range) =>
                                t('pagination_total', { start: range[0], end: range[1], total }),
                        }}
                        scroll={{ x: true }}
                    />
                </div>
            </Card>

            {/* Universal Data Source Modal - pass existing source for edit */}
            <UniversalDataSourceModal
                isOpen={modalVisible}
                onClose={handleModalClose}
                onDataSourceCreated={async () => { handleModalClose(); await refreshDataSources(); }}
                existingDataSource={selectedDataSource}
            />
            </div>
            <PricingModal
                visible={pricingModalVisible}
                onClose={() => setPricingModalVisible(false)}
                onUpgrade={() => {}}
                currentPlan={'free'}
                loading={false}
            />
        </div>
    );
};

export default DataSourcesPage;