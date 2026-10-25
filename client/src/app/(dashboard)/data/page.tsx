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
    consumePipelineWizardReturn,
    parsePipelineExportPreset,
} from '@/ee/components/pipeline-wizard/pipelineWizardReturn';
import {
    PlusOutlined,
    DatabaseOutlined,
    EditOutlined,
    SafetyCertificateOutlined,
    DeleteOutlined,
    SearchOutlined,
    ArrowUpOutlined,
    BellOutlined,
    BarChartOutlined,
    CodeOutlined,
    ExclamationCircleOutlined,
    ApartmentOutlined,
    NodeIndexOutlined,
    SafetyOutlined,
    ScanOutlined,
    RocketOutlined,
} from '@ant-design/icons';

// UniversalDataSourceModal now owns the full connector catalog itself,
// including the 7 types (Databricks/REST/GraphQL/Kafka/Elasticsearch/
// InfluxDB/OpenSearch) that used to need a second, separate "Enterprise
// Data Connectors" modal here -- see that modal's own renderEnterpriseConnectorForm
// for how it embeds EnterpriseConnectorTab directly instead.
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
import { countDuplicateFileSources, workbookIdFromDataSource } from '@/utils/workbookDataSource';
import { isLakehouseComputeDataSource } from '@/utils/lakehouseComputeSource';
import { isModelEligibleDataSource } from '@/components/data/modelEligible';
import { fetchApi } from '@/utils/api';
import { useProjectStore } from '@/stores/useProjectStore';
import { useDataSources, useDeleteDataSource, dataSourceKeys } from '@/hooks/useDataSources';
import { OtherProjectConnections } from './_components/OtherProjectConnections';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import { getDataSource } from '@/api/dataSources';
import { useFormatUserError } from '@/hooks/useFormatUserError';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';
import { useSubscriptionStore as useSubscription } from '@/stores/useSubscriptionStore';
import { useCanManageDataAccess } from '@/hooks/access/useCanManageDataAccess';
import { DataSourceIcon } from '@/utils/dataSourceIcons';
import { useSearchParams, useRouter } from 'next/navigation';
import { useImpactConfirm } from '@/components/impact/impact';
import { useTranslations } from 'next-intl';
import { BypassIndicator } from './_components/BypassIndicator';
import { semanticLayerStudioHref } from './sources/[id]/_components/tabParam';

const isEEEdition = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

const { Title, Text } = Typography;

const isSampleDataSource = (ds: { type?: string | null }) =>
    (ds.type || '').toLowerCase() === 'sample_duckdb';

// DataSource.connection_status is only ever 'connected' | 'failed' | 'unknown' | null —
// there's no 'disconnected'/'error' value in the data. Those are just the
// user-facing labels for 'unknown' (never connected/tested) and 'failed'
// (a connection attempt errored out) respectively. Normalizing here keeps
// the filter's displayed labels intuitive while matching real values.
type NormalizedConnectionStatus = 'connected' | 'unknown' | 'failed';
const normalizeConnectionStatus = (
    status: DataSource['connection_status'] | undefined,
): NormalizedConnectionStatus => (status === 'connected' || status === 'failed' ? status : 'unknown');

const DataSourcesPage: React.FC = () => {
    const canManageAccess = useCanManageDataAccess();
    const t = useTranslations('data_page');
    const tLake = useTranslations('lakehouse_compute_source');
    const formatError = useFormatUserError();
    const { usage, refresh } = useSubscription();
    const searchParams = useSearchParams();
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedDataSource, setSelectedDataSource] = useState<DataSource | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | DataSource['type']>('all');
    const [pricingModalVisible, setPricingModalVisible] = useState(false);
    const [profileDataSource, setProfileDataSource] = useState<DataSource | null>(null);
    const [profileResult, setProfileResult] = useState<Record<string, unknown> | null>(null);
    const [profileLoading, setProfileLoading] = useState(false);
    // NOTE: no backend data-profiling/PII-scan endpoint exists yet - this drawer's UI
    // (quality score, per-column PII table below) was built ahead of that endpoint and
    // nothing currently opens it. Wiring a real scan here is a separate feature, not a
    // bug fix, so this reports the honest current state instead of fabricating results.
    const handleProfileDataSource = async (ds: DataSource) => {
        setProfileLoading(true);
        setProfileResult(null);
        message.info(t('profile_not_yet_available', { name: ds.name }));
        setProfileLoading(false);
    };
    const [tablePagination, setTablePagination] = useState({ current: 1, pageSize: 10 });
    const { dataSources, isLoading } = useDataSources();
    const projectSourceIds = useMemo(
        () => new Set((dataSources || []).map((ds) => String(ds.id))),
        [dataSources],
    );
    const currentProjectId = useProjectStore((s) => s.currentProjectId);
    const [dedupeBusy, setDedupeBusy] = useState(false);
    const duplicateFileCount = useMemo(
        () => countDuplicateFileSources(dataSources || []),
        [dataSources],
    );
    const { mutateAsync: deleteDataSource } = useDeleteDataSource();
    const confirmWithImpact = useImpactConfirm();
    const qc = useQueryClient();
    const refreshDataSources = () => qc.invalidateQueries({ queryKey: ['data-sources'] });

    const handleDedupeFileSources = async () => {
        setDedupeBusy(true);
        try {
            const q = currentProjectId ? `?project_id=${encodeURIComponent(String(currentProjectId))}` : '';
            const res = await fetchApi<{ deactivated_count?: number }>(`/api/workbooks/dedupe-file-sources${q}`, {
                method: 'POST',
            });
            const n = Number(res?.deactivated_count) || 0;
            message.success(n > 0 ? t('dedupe_file_sources_ok', { count: n }) : t('dedupe_file_sources_none'));
            refreshDataSources();
        } catch (err) {
            message.error(formatError(err));
        } finally {
            setDedupeBusy(false);
        }
    };
    const authenticatedFetch = useAuthenticatedFetch();
    const { hasPermission, loading: permissionsLoading } = usePermissions();
    const canManageDataSettings =
        !permissionsLoading &&
        (hasPermission(Permission.ORG_DELETE) ||
            hasPermission(Permission.DATA_DELETE) ||
            hasPermission(Permission.DATA_EDIT) ||
            hasPermission(Permission.DATA_CREATE) ||
            hasPermission(Permission.DATA_CONNECT) ||
            hasPermission(Permission.DATA_UPLOAD));

    // Open edit modal when navigating from settings with ?edit=<id>
    const openedEditIdRef = React.useRef<string | null>(null);
    const editId = searchParams?.get('edit');
    useEffect(() => {
        if (!editId || dataSources.length === 0) return;
        if (!canManageDataSettings) return;
        if (openedEditIdRef.current === editId) return;
        const ds = dataSources.find((d) => d.id === editId);
        if (ds) {
            openedEditIdRef.current = editId;
            handleEditDataSource(ds).finally(() => router.replace('/data', { scroll: false }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when editId or data list length changes
    }, [editId, dataSources.length, canManageDataSettings]);

    const modelId = searchParams?.get('model');
    const openedModelIdRef = React.useRef<string | null>(null);
    useEffect(() => {
        if (!modelId || dataSources.length === 0) return;
        if (openedModelIdRef.current === modelId) return;
        const ds = dataSources.find((d) => d.id === modelId);
        if (ds) {
            openedModelIdRef.current = modelId;
            router.replace(semanticLayerStudioHref(ds.id), { scroll: false });
        }
    }, [modelId, dataSources, router]);


    
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
        await confirmWithImpact({
            kind: 'data_source',
            id: String(dataSource.id),
            title: t('delete_data_source'),
            content: t('delete_confirm_content', { name: dataSource.name }),
            okText: t('delete'),
            danger: true,
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
        // Real connection_status values are 'connected' | 'failed' | 'unknown' | null —
        // this used to switch on 'disconnected'/'error'/'testing', which never
        // matched real data, so a failed connection silently rendered as a
        // neutral grey tag instead of red. See normalizeConnectionStatus above.
        switch (status) {
            case 'connected':
                return 'success';
            case 'failed':
                return 'error';
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
            render: (text: string, record: DataSource) => {
                const workbookId = workbookIdFromDataSource(record);
                return (
                // One line: icon, the name (a long one truncates, full name on hover), its tags.
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <DataSourceIcon type={record.type} dbType={record.db_type} size={18} style={{ opacity: 0.9, flexShrink: 0 }} />
                    <a
                        onClick={() => router.push(`/data/sources/${record.id}`)}
                        style={{ color: 'inherit', cursor: 'pointer', minWidth: 0, flex: '0 1 auto', display: 'flex' }}
                    >
                        <Text strong ellipsis={{ tooltip: text }}>{text}</Text>
                    </a>
                    {workbookId ? (
                        <Tag
                            bordered
                            color="blue"
                            className="page-table-tag"
                            style={{ cursor: 'pointer', margin: 0, flexShrink: 0 }}
                            onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/sheets/${workbookId}`);
                            }}
                        >
                            {t('linked_sheet')}
                        </Tag>
                    ) : null}
                    {isLakehouseComputeDataSource(record) ? (
                        <Tag bordered className="page-table-tag" color="purple" style={{ margin: 0, flexShrink: 0 }}>
                            {tLake('badge')}
                        </Tag>
                    ) : null}
                </div>
                );
            },
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
        ...(isEEEdition && canManageAccess
            ? [
                {
                    title: t('col_row_access'),
                    key: 'row_access',
                    width: 140,
                    render: (_: any, record: DataSource) => <BypassIndicator dataSourceId={record.id} />,
                },
            ]
            : []),
        ...(canManageDataSettings
            ? [
                {
                    title: t('col_actions'),
                    key: 'actions',
                    width: canManageAccess ? 240 : 200,
                    align: 'right' as const,
                    render: (_: any, record: DataSource) => (
                        <Space size={0}>
                            {isEEEdition && isModelEligibleDataSource(record.type) ? (
                                <Tooltip title={t('open_model')}>
                                    <Button
                                        type="text"
                                        size="small"
                                        className="icon-only-btn"
                                        icon={<NodeIndexOutlined />}
                                        aria-label={t('open_model')}
                                        onClick={() => router.push(semanticLayerStudioHref(record.id))}
                                    />
                                </Tooltip>
                            ) : null}
                            {canManageAccess ? (
                                <Tooltip title={t('manage_access')}>
                                    <Button
                                        type="text"
                                        size="small"
                                        className="icon-only-btn"
                                        icon={<SafetyCertificateOutlined />}
                                        aria-label={t('manage_access')}
                                        onClick={() => router.push(`/data/sources/${record.id}?tab=access`)}
                                    />
                                </Tooltip>
                            ) : null}
                            <Tooltip title={t('edit_connection')}>
                                <Button
                                    type="text"
                                    size="small"
                                    className="icon-only-btn"
                                    icon={<EditOutlined />}
                                    aria-label={t('edit_connection')}
                                    onClick={() => handleEditDataSource(record)}
                                />
                            </Tooltip>
                            <Tooltip title={t('delete')}>
                                <Button
                                    type="text"
                                    size="small"
                                    danger
                                    className="icon-only-btn"
                                    icon={<DeleteOutlined />}
                                    aria-label={t('delete')}
                                    onClick={() => handleDeleteDataSource(record)}
                                />
                            </Tooltip>
                        </Space>
                    ),
                },
            ]
            : []),
    ];

    const filteredDataSources = useMemo(() => {
        return dataSources.filter((ds) => {
            const matchesSearch = ds.name.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesType = typeFilter === 'all' || ds.type === typeFilter;
            return matchesSearch && matchesType;
        });
    }, [dataSources, searchTerm, typeFilter]);

    const planCountableDataSources = useMemo(
        () => dataSources.filter((ds) => !isSampleDataSource(ds)),
        [dataSources],
    );


    // Use real subscription limits from SubscriptionContext
    const dsUsage = usage?.data_sources_count;
    const dataSourcesLimit = dsUsage ? (dsUsage.unlimited ? -1 : (dsUsage.limit ?? -1)) : -1;
    const dataSourcesUsedCount = dsUsage ? (dsUsage.used ?? planCountableDataSources.length) : planCountableDataSources.length;
    const dataSourcesPercent = dsUsage ? (dsUsage.percentage ?? 0) : 0;
    const canAddDataSource = dataSourcesLimit < 0 || dataSourcesUsedCount < dataSourcesLimit;

    // Activity inbox / deep links: /data?openDataSource=1 opens the add-data-source modal (same as Connect)
    const openDataSourceParam = searchParams?.get('openDataSource');
    const connectPreset = searchParams?.get('preset');
    const [connectModalPreset, setConnectModalPreset] = React.useState<{
        type: 'database' | 'warehouse' | 'google_sheets' | 'file';
        databaseType?: string;
        purpose?: 'pipeline_lake' | 'pipeline_export';
    } | null>(null);
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
        const exportDb = parsePipelineExportPreset(connectPreset);
        if (connectPreset === 'lake_s3' || connectPreset === 'pipeline_lake_s3') {
            setConnectModalPreset({ type: 'warehouse', databaseType: 's3_parquet', purpose: 'pipeline_lake' });
        } else if (exportDb === 'google_sheets') {
            setConnectModalPreset({ type: 'google_sheets', purpose: 'pipeline_export' });
        } else if (exportDb === 'csv' || exportDb === 'parquet' || exportDb === 'excel') {
            setConnectModalPreset({
                type: 'file',
                databaseType: exportDb === 'excel' ? 'xlsx' : exportDb,
                purpose: 'pipeline_export',
            });
        } else if (exportDb) {
            setConnectModalPreset({ type: 'database', databaseType: exportDb, purpose: 'pipeline_export' });
        } else {
            setConnectModalPreset(null);
        }
        setModalVisible(true);
        router.replace('/data', { scroll: false });
    }, [
        openDataSourceParam,
        connectPreset,
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
            loadingFallback={<AppLoadingIndicator variant="inline" slowAfterMs={8000} />}
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
                    <PermissionGuard
                        permission={[
                            Permission.DATA_CONNECT,
                            Permission.DATA_CREATE,
                            Permission.DATA_UPLOAD,
                            Permission.DATA_EDIT,
                            Permission.ORG_DELETE,
                        ]}
                    >
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
            {duplicateFileCount > 0 && canManageDataSettings ? (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={t('dedupe_file_sources_banner', { count: duplicateFileCount })}
                    action={
                        <Button size="small" loading={dedupeBusy} onClick={() => void handleDedupeFileSources()}>
                            {t('dedupe_file_sources_action')}
                        </Button>
                    }
                />
            ) : null}
            <Card className="content-card page-section-card">
                {/* One row: find a connection by name or narrow by kind. */}
                <div className="page-panel-toolbar">
                    <div className="page-panel-toolbar__row">
                        <Segmented
                            value={typeFilter}
                            onChange={(value) => setTypeFilter(value as typeof typeFilter)}
                            options={[
                                { label: t('filter_all_types'), value: 'all' },
                                { label: t('filter_databases'), value: 'database' },
                                { label: t('filter_files'), value: 'file' },
                                { label: t('filter_apis'), value: 'api' },
                                { label: t('filter_documents'), value: 'knowledge_base' },
                            ]}
                        />
                        <Input
                            className="page-panel-toolbar__search"
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder={t('search_sources')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
                <Divider className="page-divider" />
                {isEnterpriseEdition && <OtherProjectConnections projectSourceIds={projectSourceIds} />}
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
                                        searchTerm || typeFilter !== 'all'
                                            ? t('empty_filtered')
                                            : t('empty_none')
                                    }
                                >
                                    {!searchTerm && typeFilter === 'all' && canManageDataSettings && (
                                        <Button
                                            type="primary"
                                            icon={<PlusOutlined />}
                                            onClick={handleAddDataSource}
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
                initialDataSourceType={connectModalPreset?.type}
                initialDatabaseType={connectModalPreset?.databaseType}
                connectionPurpose={connectModalPreset?.purpose}
                onDataSourceCreated={async (created) => {
                    handleModalClose();
                    setConnectModalPreset(null);
                    await refreshDataSources();
                    const returnTo = consumePipelineWizardReturn();
                    if (returnTo) {
                        router.push(returnTo);
                        return;
                    }
                    if (created?.id) {
                        const isModelEligible = isModelEligibleDataSource(created.type);
                        message.success(
                            <span>
                                {t('connected_success', { name: created.name || t('unknown') })}{' '}
                                {isModelEligible && (
                                    <Button
                                        type="link"
                                        size="small"
                                        style={{ padding: 0 }}
                                        onClick={() => router.push(semanticLayerStudioHref(created.id))}
                                    >
                                        {t('open_model')}
                                    </Button>
                                )}
                                {' · '}
                                <Button
                                    type="link"
                                    size="small"
                                    style={{ padding: 0 }}
                                    onClick={() => router.push(`/chat?data_source_id=${encodeURIComponent(created.id)}`)}
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
                size={700}
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
                onUpgrade={() => {
                    setPricingModalVisible(false);
                    void refresh();
                }}
                currentPlan={'free'}
                loading={false}
            />
        </DashboardPageShell>
        </PermissionGuard>
    );
};

export default DataSourcesPage;
