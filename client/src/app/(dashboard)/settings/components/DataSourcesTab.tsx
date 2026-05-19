import React, { useMemo, useState } from 'react';
import {
  Card,
  Table,
  Tag,
  Badge,
  Space,
  Input,
  Select,
  Button,
  Typography,
  Empty,
  Modal,
  Tooltip,
  message,
} from 'antd';
import { DatabaseOutlined, SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { DataSourceIcon } from '@/utils/dataSourceIcons';
import { fetchApi } from '@/utils/api';
import UniversalDataSourceModal from '@/components/data/UniversalDataSourceModal/UniversalDataSourceModal';
import type { DataSource as SettingsDataSource } from '../types';

const { Text } = Typography;
const { Option } = Select;

export const DataSourcesTab: React.FC = () => {
  const t = useTranslations('settings');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editingSource, setEditingSource] = useState<SettingsDataSource | null>(null);
  const { currentProject } = useProjectStore();

  const {
    dataSources,
    dataSourceSearch,
    dataSourceStatusFilter,
    setDataSourceSearch,
    setDataSourceStatusFilter,
    loadDataSources,
  } = useSettingsStore();

  const reloadDataSources = () => loadDataSources(currentProject?.id as string | undefined);

  const handleEdit = async (record: SettingsDataSource) => {
    try {
      const full = await fetchApi(`/api/data/sources/${record.id}`, { method: 'GET' });
      setEditingSource({ ...record, ...full } as SettingsDataSource);
      setAddModalVisible(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('data_source_load_failed');
      message.error(msg);
    }
  };

  const handleAddDataSource = () => {
    setEditingSource(null);
    setAddModalVisible(true);
  };

  const handleModalClose = () => {
    setAddModalVisible(false);
    setEditingSource(null);
  };

  const handleDataSourceCreated = async () => {
    handleModalClose();
    await reloadDataSources();
  };

  const handleDelete = (record: SettingsDataSource) => {
    Modal.confirm({
      title: t('data_source_delete_title'),
      content: t('data_source_delete_confirm', { name: record.name }),
      okText: t('delete'),
      okType: 'danger',
      cancelText: t('cancel'),
      onOk: async () => {
        setDeletingId(record.id);
        try {
          await fetchApi(`/api/data/sources/${record.id}`, { method: 'DELETE' });
          message.success(t('data_source_deleted'));
          await reloadDataSources();
        } catch (e) {
          const msg = e instanceof Error ? e.message : t('data_source_delete_failed');
          message.error(msg);
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  // Data fetching is now handled by the parent SettingsPage based on active tab

  const filteredDataSources = useMemo(() => {
    return dataSources.filter((ds) => {
      const matchesSearch =
        !dataSourceSearch ||
        ds.name?.toLowerCase().includes(dataSourceSearch.toLowerCase()) ||
        ds.type?.toLowerCase().includes(dataSourceSearch.toLowerCase());
      const matchesStatus = dataSourceStatusFilter === 'all' || ds.status === dataSourceStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [dataSources, dataSourceSearch, dataSourceStatusFilter]);

  const dataSourceColumns = [
    {
      title: t('name'),
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: SettingsDataSource) => (
        <Space>
          <DataSourceIcon type={record.type} dbType={record.db_type} size={18} style={{ opacity: 0.9 }} />
          <Text strong>{text || t('profile_na')}</Text>
        </Space>
      ),
    },
    {
      title: t('type'),
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => (
        <Tag
          color={
            type === 'database'
              ? 'blue'
              : type === 'file'
                ? 'green'
                : type === 'warehouse'
                  ? 'purple'
                  : type === 'api'
                    ? 'orange'
                    : 'default'
          }
        >
          {type?.toUpperCase() || t('unknown')}
        </Tag>
      ),
    },
    {
      title: t('status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Badge
          status={status === 'connected' ? 'success' : status === 'failed' ? 'error' : 'processing'}
          text={status?.charAt(0).toUpperCase() + status?.slice(1) || t('unknown')}
        />
      ),
    },
    {
      title: t('connected'),
      dataIndex: 'connected_at',
      key: 'connected_at',
      render: (date: string) => (date ? new Date(date).toLocaleDateString() : t('profile_na')),
    },
    {
      title: t('last_sync'),
      dataIndex: 'last_sync',
      key: 'last_sync',
      render: (date: string) => (date ? new Date(date).toLocaleDateString() : t('never')),
    },
    {
      title: t('col_actions'),
      key: 'actions',
      width: 120,
      render: (_: unknown, record: SettingsDataSource) => (
        <Space>
          <Tooltip title={t('edit_connection')}>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
              disabled={!!deletingId}
            />
          </Tooltip>
          <Tooltip title={t('delete')}>
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deletingId === record.id}
              onClick={() => handleDelete(record)}
              disabled={!!deletingId}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small"
      bordered={false}
      style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}
      title={
        <Space>
          <DatabaseOutlined />
          {t('data_sources')}
        </Space>
      }
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddDataSource}>
          {t('add_data_source')}
        </Button>
      }
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space
          wrap
          className="data-sources-search-row"
          style={{ width: '100%', justifyContent: 'space-between', gap: 8 }}
        >
          <Input
            placeholder={t('search_data_sources')}
            prefix={<SearchOutlined />}
            value={dataSourceSearch}
            onChange={(e) => setDataSourceSearch(e.target.value)}
            className="data-sources-search-input"
            style={{ minWidth: 180, flex: '1 1 180px', maxWidth: 280 }}
            allowClear
          />
          <Select
            value={dataSourceStatusFilter}
            onChange={setDataSourceStatusFilter}
            className="data-sources-status-select"
            style={{ minWidth: 120, width: 150 }}
          >
            <Option value="all">{t('all_status')}</Option>
            <Option value="connected">{t('connected')}</Option>
            <Option value="failed">{t('failed')}</Option>
            <Option value="pending">{t('pending')}</Option>
          </Select>
        </Space>

        {dataSources.length === 0 ? (
          <Empty description={t('no_data_sources_configured')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddDataSource}>
              {t('add_first_data_source')}
            </Button>
          </Empty>
        ) : (
          <Table
            dataSource={filteredDataSources}
            columns={dataSourceColumns}
            rowKey="id"
            pagination={{ pageSize: 10 }}
            scroll={{ x: 'max-content' }}
          />
        )}
      </Space>

      <UniversalDataSourceModal
        isOpen={addModalVisible}
        onClose={handleModalClose}
        onDataSourceCreated={handleDataSourceCreated}
        existingDataSource={
          editingSource
            ? {
                id: editingSource.id,
                name: editingSource.name || '',
                type: editingSource.type || 'database',
                connection_config: (editingSource as any).connection_config,
                description: (editingSource as any).description,
              }
            : null
        }
      />
    </Card>
  );
};
