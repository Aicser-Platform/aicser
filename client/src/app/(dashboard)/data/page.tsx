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
    Drawer,
} from 'antd';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import {
    PlusOutlined,
    DatabaseOutlined,
    EditOutlined,
    DeleteOutlined,
    ReloadOutlined,
    SearchOutlined,
    ArrowUpOutlined,
    BellOutlined,
    BarChartOutlined,
    CheckCircleOutlined,
    CloudServerOutlined,
    CodeOutlined,
    ExclamationCircleOutlined,
    FileTextOutlined,
    ApartmentOutlined,
    SafetyOutlined,
    ScanOutlined,
    RocketOutlined,
} from '@ant-design/icons';

const UniversalDataSourceModal = nextDynamic(
    () => import('@/components/data/UniversalDataSourceModal/UniversalDataSourceModal').then((m) => m.default),
    { ssr: false }
);
import { usePlanRestrictions } from '@/hooks/usePlanRestrictions';
import { usePermissions, Permission } from '@/hooks/usePermissions';
import { PermissionGuard } from '@/components/PermissionGuard';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import PricingModal from '@/components/PricingModal';
import { type DataSource } from '@/stores/useDataSourceStore';
import { useDataSources, useDeleteDataSource, dataSourceKeys } from '@/hooks/useDataSources';
import { getDataSource } from '@/api/dataSources';
import { useFormatUserError } from '@/hooks/useFormatUserError';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';
import { useSubscriptionStore as useSubscription } from '@/stores/useSubscriptionStore';
import { DataSourceIcon } from '@/utils/dataSourceIcons';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DataModelRelationships } from '@/components/data/DataModelRelationships';

const isEEEdition = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

const ConnectModelVisualizeWizard = nextDynamic(
  () => isEEEdition
    ? import('@/ee').then((m) => m.ConnectModelVisualizeWizard)
    : Promise.resolve(() => null as React.ReactElement | null),
  { ssr: false },
);

const { Title, Text } = Typography;

const isSampleDataSource = (ds: { type?: string | null }) =>
    (ds.type || '').toLowerCase() === 'sample_duckdb';

const DataSourcesPage: React.FC = () => {
    const t = useTranslations('data_page');
    const formatError = useFormatUserError();
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
    const [modelDataSource, setModelDataSource] = useState<DataSource | null>(null);
    const [wizardSource, setWizardSource] = useState<DataSource | null>(null);
    const [profileDataSource, setProfileDataSource] = useState<DataSource | null>(null);
    const [profileResult, setProfileResult] = useState<Record<string, unknown> | null>(null);
    const [profileLoading, setProfileLoading] = useState(false);
    const [tablePagination, setTablePagination] = useState({ current: 1, pageSize: 10 });
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

    const modelId = searchParams?.get('model');
    const openedModelIdRef = React.useRef<string | null>(null);
    useEffect(() => {
        if (!modelId || dataSources.length === 0) return;
        if (openedModelIdRef.current === modelId) return;
        const ds = dataSources.find((d) => d.id === modelId);
        if (ds) {
            openedModelIdRef.current = modelId;
            setModelDataSource(ds);
            router.replace('/data', { scroll: false });
        }
    }, [modelId, dataSources, router]);

    const isModelEligible = (ds: DataSource) =>
        ['database', 'warehouse', 'cube', 'file'].includes((ds.type || '').toLowerCase());

    
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

    // Open edit modal for existing source
    const handleEditDataSource = async (dataSource: DataSource) => {
        try {
            const full = await qc.fetchQuery({
                queryKey: dataSourceKeys.detail(dataSource.id),
                queryFn: () => getDataSource(dataSource.id),
            });
            setSelectedDataSource({ ...dataSource, ...full });
            setModalVisible(true);
        } catch (e: unknown) {
            message.error(formatError(e, 'load_failed'));
        }
    };

    // Close modal and reset state
    const handleModalClose = () => {
        setModalVisible(false);
        setSelectedDataSource(null);
        refreshDataSources();
    };

    // Handle delete with confirmation modal
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
                    message.error(formatError(error, 'delete_failed'));
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
            ellipsis: true,
            minWidth: 220,
            render: (text: string, record: DataSource) => (
                <Space>
                    <DataSourceIcon type={record.type} dbType={record.db_type} size={18} style={{ opacity: 0.9, flexShrink: 0 }} />
                    <Text strong ellipsis>{text}</Text>
                </Space>
            ),
        },
        {
            title: t('col_type'),
            dataIndex: 'type',
            key: 'type',
            width: 120,
            render: (type: string) => (
                <Tag bordered className="page-table-tag">{type.toUpperCase()}</Tag>
            ),
        },
        {
            title: t('col_status'),
            dataIndex: 'connection_status',
            key: 'connection_status',
            width: 130,
            render: (status: string) => (
                <Tag bordered color={getStatusColor(status)} className="page-table-tag">
                    {status ? status.toUpperCase() : t('unknown')}
                </Tag>
            ),
        },
        {
            title: t('col_rows'),
            dataIndex: 'row_count',
            key: 'row_count',
            width: 100,
            render: (count: number) => count ? count.toLocaleString() : '-',
        },
        {
            title: t('col_size'),
            dataIndex: 'size',
            key: 'size',
            width: 110,
            render: (size: number) => size ? `${(size / 1024).toFixed(2)} KB` : '-',
        },
        {
            title: t('col_last_used'),
            dataIndex: 'last_accessed',
            key: 'last_accessed',
            width: 120,
            render: (date: string) => date ? new Date(date).toLocaleDateString() : '-',
        },
        {
            title: t('col_actions'),
            key: 'actions',
            width: 160,
            align: 'right' as const,
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
        <PermissionGuard
            permission={Permission.DATA_VIEW}
            loadingFallback={<AppLoadingIndicator variant="inline" />}
            fallback={
                <DashboardPageShell maxWidth={720}>
                    <Alert type="warning" showIcon message={t('no_data_permission')} description={t('no_data_permission_desc')} />
                </DashboardPageShell>
            }
        >
        <DashboardPageShell>
            <DashboardPageHeader
                icon={<DatabaseOutlined />}
                title={t('title')}
                description={t('description')}
                extra={
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
                                {t('connect_data_source')}
                            </Button>
                        </Tooltip>
                    </PermissionGuard>
                }
            />
            <div className="page-body">
            {/* Statistics & quick actions — hide empty chrome until first source exists */}
            {stats.total > 0 ? (
            <Row gutter={[16, 16]} className="page-stat-grid">

                <Col xs={24} lg={6}>
                    <Card className="page-stat-tile" size="small" bordered={false}>
                        <Statistic title={t('stat_total_sources')} value={stats.total} prefix={<DatabaseOutlined />} />
                        <Text type="secondary" className="page-stat-tile__hint">{t('stat_in_project')}</Text>
                    </Card>
                </Col>
                <Col xs={24} lg={6}>
                    <Card className="page-stat-tile" size="small" bordered={false}>
                        <Statistic title={t('stat_connected')} value={stats.connected} prefix={<CheckCircleOutlined />} valueStyle={{ color: 'var(--ant-color-success)' }} />
                        <Text type="secondary" className="page-stat-tile__hint">{t('stat_healthy_connections')}</Text>
                    </Card>
                </Col>
                <Col xs={24} lg={6}>
                    <Card className="page-stat-tile" size="small" bordered={false}>
                        <Statistic title={t('stat_databases')} value={stats.databases} prefix={<CloudServerOutlined />} />
                        <Text type="secondary" className="page-stat-tile__hint">{t('stat_sql_transactional')}</Text>
                    </Card>
                </Col>
                <Col xs={24} lg={6}>
                    <Card className="page-stat-tile" size="small" bordered={false}>
                        <Statistic title={t('stat_files_apis')} value={stats.files + stats.apis} prefix={<FileTextOutlined />} />
                        <Text type="secondary" className="page-stat-tile__hint">{t('stat_flat_files_services')}</Text>
                    </Card>
                </Col>
            </Row>
            ) : null}

            <Card className="content-card page-section-card">
                <div className="page-panel-toolbar">
                    <div className="page-panel-toolbar__row">
                        <div className="page-panel-toolbar__actions">
                            <Button
                                icon={<ReloadOutlined />}
                                onClick={() => refreshDataSources()}
                                loading={isLoading}
                            >
                                {t('refresh')}
                            </Button>
                        </div>
                        <Input
                            className="page-panel-toolbar__search"
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder={t('search_sources')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="page-panel-toolbar__filters">
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
                    </div>
                </div>
                <Divider className="page-divider" />
                <div>
                    <Table
                        className="page-data-table"
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
                                >
                                    {!searchTerm && statusFilter === 'all' && typeFilter === 'all' && (
                                        <Button
                                            type="primary"
                                            icon={<PlusOutlined />}
                                            onClick={() => setModalVisible(true)}
                                            disabled={!canAddDataSource}
                                        >
                                            {t('connect_data_source')}
                                        </Button>
                                    )}
                                </Empty>
                            ),
                        }}
                        pagination={{
                            current: tablePagination.current,
                            pageSize: tablePagination.pageSize,
                            showSizeChanger: true,
                            showQuickJumper: true,
                            showTotal: (total, range) =>
                                t('pagination_total', { start: range[0], end: range[1], total }),
                            onChange: (current, pageSize) => setTablePagination({ current, pageSize }),
                        }}
                        scroll={{ x: 960 }}
                    />
                </div>
            </Card>

            {/* Universal Data Source Modal - pass existing source for edit */}
            <UniversalDataSourceModal
                isOpen={modalVisible}
                onClose={handleModalClose}
                onDataSourceCreated={async (created) => {
                    handleModalClose();
                    await refreshDataSources();
                    if (created?.id) {
                        setWizardSource(created as DataSource);
                        const isModelEligible = ['database', 'warehouse', 'cube', 'file'].includes(
                            (created.type || '').toLowerCase(),
                        );
                        message.success(
                            <span>
                                {t('connected_success', { name: created.name || t('unknown') })}{' '}
                                {isModelEligible && (
                                    <Button
                                        type="link"
                                        size="small"
                                        style={{ padding: 0 }}
                                        onClick={() => router.push(`/data/sources/${created.id}/semantic`)}
                                    >
                                        {t('open_model')}
                                    </Button>
                                )}
                                {' · '}
                                <Button
                                    type="link"
                                    size="small"
                                    style={{ padding: 0 }}
                                    onClick={() => router.push('/chat')}
                                >
                                    {t('open_ai_engine')}
                                </Button>
                            </span>,
                            8,
                        );
                    }
                }}
                existingDataSource={selectedDataSource}
            />
            {wizardSource && isEEEdition && (
                <ConnectModelVisualizeWizard
                    open={!!wizardSource}
                    dataSourceId={wizardSource.id}
                    dataSourceName={wizardSource.name}
                    onClose={() => setWizardSource(null)}
                />
            )}
            <Drawer
                title={modelDataSource ? t('data_model_title', { name: modelDataSource.name }) : t('data_model')}
                open={!!modelDataSource}
                onClose={() => setModelDataSource(null)}
                width={720}
                destroyOnHidden
            >
                {modelDataSource && (
                    <DataModelRelationships dataSourceId={modelDataSource.id} />
                )}
            </Drawer>

            {/* Data Profile + PII Drawer */}
            <Drawer
                title={
                    <span>
                        <ScanOutlined style={{ marginRight: 8, color: 'var(--ant-color-primary)' }} />
                        {t('profile_drawer_title', { name: profileDataSource?.name ?? '' })}
                    </span>
                }
                open={!!profileDataSource}
                onClose={() => { setProfileDataSource(null); setProfileResult(null); }}
                width={700}
                destroyOnHidden
                extra={
                    profileDataSource && (
                        <Button
                            size="small"
                            icon={<ScanOutlined />}
                            loading={profileLoading}
                            onClick={() => profileDataSource && handleProfileDataSource(profileDataSource)}
                        >
                            {t('re_scan')}
                        </Button>
                    )
                }
            >
                {profileLoading && (
                    <div style={{ padding: 24 }}>
                        <AppLoadingIndicator variant="inline" tip={t('profiling_in_progress')} />
                    </div>
                )}
                {!profileLoading && !profileResult && (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--ant-color-text-secondary)' }}>
                        {t('profile_click_scan')}
                    </div>
                )}
                {!profileLoading && profileResult && (() => {
                    const cols = (profileResult.columns as Record<string, unknown>[] | null) ?? [];
                    const overallScore = typeof profileResult.quality_score === 'number' ? profileResult.quality_score : null;
                    const piiCols = cols.filter((c: any) => c.pii_detected || (c.pii_types && (c.pii_types as string[]).length > 0));
                    const highNullCols = cols.filter((c: any) => (c.null_pct ?? 0) > 0.5);
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* Quality score summary */}
                            <Card size="small" title={t('profile_summary')}>
                                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                                    <div>
                                        <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)' }}>{t('profile_quality_score')}</div>
                                        <div style={{ fontSize: 22, fontWeight: 700, color: overallScore !== null && overallScore >= 0.8 ? 'var(--ant-color-success)' : overallScore !== null && overallScore >= 0.5 ? 'var(--ant-color-warning)' : 'var(--ant-color-error)' }}>
                                            {overallScore !== null ? `${Math.round(overallScore * 100)}%` : '—'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)' }}>{t('profile_columns')}</div>
                                        <div style={{ fontSize: 22, fontWeight: 700 }}>{cols.length}</div>
                                    </div>
                                    {piiCols.length > 0 && (
                                        <div>
                                            <div style={{ fontSize: 11, color: 'var(--ant-color-text-secondary)' }}>{t('profile_pii_cols')}</div>
                                            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ant-color-warning)' }}>
                                                {piiCols.length}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {piiCols.length > 0 && (
                                    <Alert
                                        type="warning"
                                        showIcon
                                        icon={<SafetyOutlined />}
                                        style={{ marginTop: 12 }}
                                        message={t('profile_pii_warning', { n: piiCols.length })}
                                        description={t('profile_pii_desc')}
                                    />
                                )}
                            </Card>

                            {/* Per-column profile table */}
                            <Card size="small" title={t('profile_columns_detail')}>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--ant-color-border)' }}>
                                                {[t('col_name'), t('profile_type'), t('profile_null_pct'), t('profile_unique'), t('profile_quality'), t('profile_pii')].map((h) => (
                                                    <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--ant-color-text-secondary)' }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {cols.map((col: any, i: number) => {
                                                const nullPct = typeof col.null_pct === 'number' ? `${Math.round(col.null_pct * 100)}%` : '—';
                                                const colScore = typeof col.quality_score === 'number' ? Math.round(col.quality_score * 100) : null;
                                                const hasPii = col.pii_detected || (col.pii_types?.length > 0);
                                                const piiTypes: string[] = col.pii_types || [];
                                                return (
                                                    <tr key={i} style={{ borderBottom: '1px solid var(--ant-color-border-secondary)', background: hasPii ? 'var(--ant-color-warning-bg)' : 'transparent' }}>
                                                        <td style={{ padding: '5px 8px', fontWeight: 500 }}>{col.column || col.name}</td>
                                                        <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 11 }}>{col.type_inferred || '—'}</td>
                                                        <td style={{ padding: '5px 8px', color: (col.null_pct ?? 0) > 0.5 ? 'var(--ant-color-error)' : 'inherit' }}>{nullPct}</td>
                                                        <td style={{ padding: '5px 8px' }}>{col.unique_count ?? '—'}</td>
                                                        <td style={{ padding: '5px 8px' }}>
                                                            {colScore !== null ? (
                                                                <Tag color={colScore >= 80 ? 'success' : colScore >= 50 ? 'warning' : 'error'} style={{ fontSize: 10 }}>
                                                                    {colScore}%
                                                                </Tag>
                                                            ) : '—'}
                                                        </td>
                                                        <td style={{ padding: '5px 8px' }}>
                                                            {hasPii ? (
                                                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                                    {piiTypes.slice(0, 3).map((p: string) => (
                                                                        <Tag key={p} color="orange" icon={<ExclamationCircleOutlined />} style={{ fontSize: 10, margin: 0 }}>{p}</Tag>
                                                                    ))}
                                                                </div>
                                                            ) : <Tag color="success" style={{ fontSize: 10 }}>Clean</Tag>}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>

                            {highNullCols.length > 0 && (
                                <Alert
                                    type="info"
                                    showIcon
                                    message={t('profile_high_null_warning', { n: highNullCols.length })}
                                    description={highNullCols.map((c: any) => c.column || c.name).join(', ')}
                                />
                            )}
                        </div>
                    );
                })()}
            </Drawer>
            </div>
            <PricingModal
                visible={pricingModalVisible}
                onClose={() => setPricingModalVisible(false)}
                onUpgrade={() => {}}
                currentPlan={'free'}
                loading={false}
            />
        </DashboardPageShell>
        </PermissionGuard>
    );
};

export default DataSourcesPage;
