import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import {
  useCreateDataSourceRLSPolicy,
  useDataSourceAccessGrants,
  useDataSourceRLSPolicies,
  useDeleteDataSourceRLSPolicy,
  useRevokeDataSourceAccessGrant,
  useUpdateDataSourceRLSPolicy,
  useUpsertDataSourceAccessGrant,
} from '@/hooks/useDataSources';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import type {
  DataSourceAccessGrant,
  DataSourceAccessGrantRequest,
  DataSourceRLSOperator,
  DataSourceRLSPolicy,
  DataSourceRLSPolicyRequest,
  DataSourceRLSValueType,
  DataSourceGrantGranteeType,
  DataSourceGrantPermission,
} from '@/api/dataSources';
import type { DataSource as SettingsDataSource } from '../types';

const { Text } = Typography;

const GRANTEE_TYPES: DataSourceGrantGranteeType[] = [
  'project',
  'user',
  'group',
  'org_role',
  'project_role',
];

const PERMISSIONS: DataSourceGrantPermission[] = [
  'view',
  'query',
  'edit',
  'manage',
  'share',
];

const RLS_OPERATORS: DataSourceRLSOperator[] = [
  'eq',
  'in',
  'not_in',
  'between',
  'is_null',
  'is_not_null',
];

const RLS_VALUE_TYPES: DataSourceRLSValueType[] = [
  'fixed',
  'user_attribute',
  'group_attribute',
  'org_attribute',
  'project_attribute',
];

type DataSourceAccessDrawerProps = {
  open: boolean;
  dataSource: SettingsDataSource | null;
  onClose: () => void;
};

type RLSPolicyFormValues = Omit<DataSourceRLSPolicyRequest, 'rules' | 'settings'> & {
  rules: Array<{
    table_name: string;
    column_name: string;
    operator: DataSourceRLSOperator;
    value_type: DataSourceRLSValueType;
    value?: string;
    sort_order?: number;
  }>;
};

const parseRuleValue = (
  operator: DataSourceRLSOperator,
  valueType: DataSourceRLSValueType,
  rawValue?: string
): unknown => {
  const value = String(rawValue ?? '').trim();
  if (operator === 'is_null' || operator === 'is_not_null') return null;
  if (valueType !== 'fixed') return value;
  if (!value) return null;
  if (operator === 'in' || operator === 'not_in' || operator === 'between') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const stringifyRuleValue = (value: unknown): string => {
  if (Array.isArray(value)) return value.join(', ');
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export const DataSourceAccessDrawer: React.FC<DataSourceAccessDrawerProps> = ({
  open,
  dataSource,
  onClose,
}) => {
  const t = useTranslations('settings');
  const [form] = Form.useForm<DataSourceAccessGrantRequest>();
  const [rlsForm] = Form.useForm<RLSPolicyFormValues>();
  const [editingPolicy, setEditingPolicy] = useState<DataSourceRLSPolicy | null>(null);
  const dataSourceId = dataSource?.id ?? null;
  const { grants, isLoading, isFetching } = useDataSourceAccessGrants(dataSourceId, open);
  const { policies, isLoading: policiesLoading, isFetching: policiesFetching } =
    useDataSourceRLSPolicies(dataSourceId, open);
  const upsertGrant = useUpsertDataSourceAccessGrant();
  const revokeGrant = useRevokeDataSourceAccessGrant();
  const createPolicy = useCreateDataSourceRLSPolicy();
  const updatePolicy = useUpdateDataSourceRLSPolicy();
  const deletePolicy = useDeleteDataSourceRLSPolicy();

  const policyOptions = useMemo(
    () => [
      { label: t('data_source_access_no_rls_policy'), value: '' },
      ...policies.map((policy) => ({
        label: policy.name,
        value: policy.id,
      })),
    ],
    [policies, t]
  );

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      grantee_type: 'project',
      grantee_id: '',
      permissions: ['view', 'query'],
      rls_policy_id: null,
    });
    setEditingPolicy(null);
    rlsForm.setFieldsValue({
      name: '',
      description: '',
      enabled: true,
      default_deny: true,
      rules: [
        {
          table_name: '',
          column_name: '',
          operator: 'eq',
          value_type: 'user_attribute',
          value: '',
          sort_order: 0,
        },
      ],
    });
  }, [form, rlsForm, open, dataSourceId]);

  const handleAddGrant = async (values: DataSourceAccessGrantRequest) => {
    if (!dataSourceId) return;
    try {
      await upsertGrant.mutateAsync({
        id: dataSourceId,
        data: {
          ...values,
          grantee_id: values.grantee_id.trim(),
          rls_policy_id: values.rls_policy_id?.trim() || null,
        },
      });
      message.success(t('data_source_access_grant_saved'));
      form.setFieldsValue({
        grantee_id: '',
        permissions: ['view', 'query'],
        rls_policy_id: null,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('data_source_access_grant_save_failed');
      message.error(msg);
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    if (!dataSourceId) return;
    try {
      await revokeGrant.mutateAsync({ id: dataSourceId, grantId });
      message.success(t('data_source_access_grant_revoked'));
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('data_source_access_grant_revoke_failed');
      message.error(msg);
    }
  };

  const startEditPolicy = (policy: DataSourceRLSPolicy) => {
    setEditingPolicy(policy);
    rlsForm.setFieldsValue({
      name: policy.name,
      description: policy.description ?? '',
      enabled: policy.enabled,
      default_deny: policy.default_deny,
      rules: policy.rules.length
        ? policy.rules.map((rule) => ({
            table_name: rule.table_name,
            column_name: rule.column_name,
            operator: rule.operator,
            value_type: rule.value_type,
            value: stringifyRuleValue(rule.value),
            sort_order: rule.sort_order,
          }))
        : [
            {
              table_name: '',
              column_name: '',
              operator: 'eq',
              value_type: 'user_attribute',
              value: '',
              sort_order: 0,
            },
          ],
    });
  };

  const resetPolicyForm = () => {
    setEditingPolicy(null);
    rlsForm.resetFields();
    rlsForm.setFieldsValue({
      enabled: true,
      default_deny: true,
      rules: [
        {
          table_name: '',
          column_name: '',
          operator: 'eq',
          value_type: 'user_attribute',
          value: '',
          sort_order: 0,
        },
      ],
    });
  };

  const handleSavePolicy = async (values: RLSPolicyFormValues) => {
    if (!dataSourceId) return;
    const payload: DataSourceRLSPolicyRequest = {
      name: values.name.trim(),
      description: values.description?.trim() || null,
      enabled: Boolean(values.enabled),
      default_deny: Boolean(values.default_deny),
      settings: {},
      rules: (values.rules || []).map((rule, index) => ({
        table_name: rule.table_name.trim(),
        column_name: rule.column_name.trim(),
        operator: rule.operator,
        value_type: rule.value_type,
        value: parseRuleValue(rule.operator, rule.value_type, rule.value),
        sort_order: Number(rule.sort_order ?? index),
      })),
    };
    try {
      if (editingPolicy) {
        await updatePolicy.mutateAsync({ id: dataSourceId, policyId: editingPolicy.id, data: payload });
        message.success(t('data_source_rls_policy_updated'));
      } else {
        await createPolicy.mutateAsync({ id: dataSourceId, data: payload });
        message.success(t('data_source_rls_policy_created'));
      }
      resetPolicyForm();
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('data_source_rls_policy_save_failed');
      message.error(msg);
    }
  };

  const handleDeletePolicy = async (policyId: string) => {
    if (!dataSourceId) return;
    try {
      await deletePolicy.mutateAsync({ id: dataSourceId, policyId });
      if (editingPolicy?.id === policyId) resetPolicyForm();
      message.success(t('data_source_rls_policy_deleted'));
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('data_source_rls_policy_delete_failed');
      message.error(msg);
    }
  };

  const columns = [
    {
      title: t('data_source_access_grantee'),
      key: 'grantee',
      render: (_: unknown, record: DataSourceAccessGrant) => (
        <Space direction="vertical" size={0}>
          <Tag>{t(`data_source_access_grantee_${record.grantee_type}`)}</Tag>
          <Text code copyable ellipsis style={{ maxWidth: 220 }}>
            {record.grantee_id}
          </Text>
        </Space>
      ),
    },
    {
      title: t('data_source_access_permissions'),
      dataIndex: 'permissions',
      key: 'permissions',
      render: (permissions: DataSourceGrantPermission[]) => (
        <Space size={[4, 4]} wrap>
          {(permissions || []).map((permission) => (
            <Tag color={permission === 'manage' || permission === 'share' ? 'gold' : 'blue'} key={permission}>
              {t(`data_source_access_permission_${permission}`)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('data_source_access_rls_policy'),
      dataIndex: 'rls_policy_id',
      key: 'rls_policy_id',
      render: (policyId?: string | null) =>
        policyId ? (
          <Tag color="purple">{policies.find((policy) => policy.id === policyId)?.name || policyId}</Tag>
        ) : (
          <Text type="secondary">{t('profile_na')}</Text>
        ),
    },
    {
      title: t('col_actions'),
      key: 'actions',
      width: 72,
      render: (_: unknown, record: DataSourceAccessGrant) => (
        <Popconfirm
          title={t('data_source_access_revoke_title')}
          okText={t('delete')}
          cancelText={t('cancel')}
          onConfirm={() => handleRevokeGrant(record.id)}
        >
          <Tooltip title={t('data_source_access_revoke')}>
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              loading={revokeGrant.isPending}
            />
          </Tooltip>
        </Popconfirm>
      ),
    },
  ];

  const policyColumns = [
    {
      title: t('data_source_rls_policy_name'),
      key: 'name',
      render: (_: unknown, record: DataSourceRLSPolicy) => (
        <Space direction="vertical" size={0}>
          <Space size={4} wrap>
            <Text strong>{record.name}</Text>
            <Tag color={record.enabled ? 'green' : 'default'}>
              {record.enabled ? t('enabled') : t('disabled')}
            </Tag>
            {record.default_deny ? <Tag color="red">{t('data_source_rls_default_deny')}</Tag> : null}
          </Space>
          <Text type="secondary">{record.description || t('profile_na')}</Text>
        </Space>
      ),
    },
    {
      title: t('data_source_rls_rules'),
      key: 'rules',
      render: (_: unknown, record: DataSourceRLSPolicy) => (
        <Space size={[4, 4]} wrap>
          {record.rules.map((rule) => (
            <Tag key={rule.id}>
              {rule.table_name}.{rule.column_name} {rule.operator}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('col_actions'),
      key: 'actions',
      width: 96,
      render: (_: unknown, record: DataSourceRLSPolicy) => (
        <Space>
          <Tooltip title={t('edit')}>
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => startEditPolicy(record)}
            />
          </Tooltip>
          <Popconfirm
            title={t('data_source_rls_policy_delete_title')}
            okText={t('delete')}
            cancelText={t('cancel')}
            onConfirm={() => handleDeletePolicy(record.id)}
          >
            <Tooltip title={t('delete')}>
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                loading={deletePolicy.isPending}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Drawer
      title={
        <Space>
          <SafetyCertificateOutlined />
          <span>{t('data_source_access_title')}</span>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={880}
      destroyOnClose
    >
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space direction="vertical" size={0}>
          <Text strong>{dataSource?.name || t('unknown')}</Text>
          <Text type="secondary">{dataSource?.type || t('unknown')}</Text>
        </Space>

        {!isEnterpriseEdition ? (
          <Empty description={t('data_source_access_ee_only')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Tabs
            items={[
              {
                key: 'grants',
                label: t('data_source_access_grants_tab'),
                children: (
                  <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <Form
                      form={form}
                      layout="vertical"
                      onFinish={handleAddGrant}
                      disabled={!dataSourceId || upsertGrant.isPending}
                    >
                      <Space align="start" size={12} wrap>
                        <Form.Item
                          name="grantee_type"
                          label={t('data_source_access_grantee_type')}
                          rules={[{ required: true }]}
                          style={{ width: 160 }}
                        >
                          <Select
                            options={GRANTEE_TYPES.map((type) => ({
                              label: t(`data_source_access_grantee_${type}`),
                              value: type,
                            }))}
                          />
                        </Form.Item>
                        <Form.Item
                          name="grantee_id"
                          label={t('data_source_access_grantee_id')}
                          rules={[{ required: true, whitespace: true }]}
                          style={{ minWidth: 220, flex: '1 1 220px' }}
                        >
                          <Input />
                        </Form.Item>
                        <Form.Item
                          name="permissions"
                          label={t('data_source_access_permissions')}
                          rules={[{ required: true }]}
                          style={{ minWidth: 260, flex: '1 1 260px' }}
                        >
                          <Select
                            mode="multiple"
                            options={PERMISSIONS.map((permission) => ({
                              label: t(`data_source_access_permission_${permission}`),
                              value: permission,
                            }))}
                          />
                        </Form.Item>
                        <Form.Item
                          name="rls_policy_id"
                          label={t('data_source_access_rls_policy')}
                          style={{ minWidth: 220, flex: '1 1 220px' }}
                        >
                          <Select options={policyOptions} />
                        </Form.Item>
                        <Form.Item style={{ marginBottom: 0, paddingTop: 30 }}>
                          <Button
                            type="primary"
                            htmlType="submit"
                            icon={<PlusOutlined />}
                            loading={upsertGrant.isPending}
                          >
                            {t('data_source_access_add_grant')}
                          </Button>
                        </Form.Item>
                      </Space>
                    </Form>

                    <Table
                      rowKey="id"
                      size="small"
                      loading={isLoading || isFetching}
                      dataSource={grants}
                      columns={columns}
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                      locale={{ emptyText: <Empty description={t('data_source_access_empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                    />
                  </Space>
                ),
              },
              {
                key: 'rls',
                label: t('data_source_rls_policies_tab'),
                children: (
                  <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <Form
                      form={rlsForm}
                      layout="vertical"
                      onFinish={handleSavePolicy}
                      disabled={!dataSourceId || createPolicy.isPending || updatePolicy.isPending}
                    >
                      <Space align="start" size={12} wrap>
                        <Form.Item
                          name="name"
                          label={t('data_source_rls_policy_name')}
                          rules={[{ required: true, whitespace: true }]}
                          style={{ minWidth: 220, flex: '1 1 220px' }}
                        >
                          <Input />
                        </Form.Item>
                        <Form.Item
                          name="description"
                          label={t('description')}
                          style={{ minWidth: 260, flex: '1 1 260px' }}
                        >
                          <Input />
                        </Form.Item>
                        <Form.Item name="enabled" label={t('enabled')} valuePropName="checked">
                          <Switch />
                        </Form.Item>
                        <Form.Item name="default_deny" label={t('data_source_rls_default_deny')} valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </Space>

                      <Form.List name="rules">
                        {(fields, { add, remove }) => (
                          <Space direction="vertical" size="small" style={{ width: '100%' }}>
                            {fields.map((field) => (
                              <Space key={field.key} align="start" size={8} wrap>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'table_name']}
                                  label={t('data_source_rls_table')}
                                  rules={[{ required: true, whitespace: true }]}
                                  style={{ width: 150 }}
                                >
                                  <Input />
                                </Form.Item>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'column_name']}
                                  label={t('data_source_rls_column')}
                                  rules={[{ required: true, whitespace: true }]}
                                  style={{ width: 150 }}
                                >
                                  <Input />
                                </Form.Item>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'operator']}
                                  label={t('data_source_rls_operator')}
                                  rules={[{ required: true }]}
                                  style={{ width: 140 }}
                                >
                                  <Select
                                    options={RLS_OPERATORS.map((operator) => ({
                                      label: t(`data_source_rls_operator_${operator}`),
                                      value: operator,
                                    }))}
                                  />
                                </Form.Item>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'value_type']}
                                  label={t('data_source_rls_value_type')}
                                  rules={[{ required: true }]}
                                  style={{ width: 170 }}
                                >
                                  <Select
                                    options={RLS_VALUE_TYPES.map((valueType) => ({
                                      label: t(`data_source_rls_value_type_${valueType}`),
                                      value: valueType,
                                    }))}
                                  />
                                </Form.Item>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'value']}
                                  label={t('data_source_rls_value')}
                                  style={{ width: 170 }}
                                >
                                  <Input />
                                </Form.Item>
                                <Form.Item
                                  {...field}
                                  name={[field.name, 'sort_order']}
                                  label={t('data_source_rls_order')}
                                  style={{ width: 92 }}
                                >
                                  <InputNumber min={0} style={{ width: '100%' }} />
                                </Form.Item>
                                <Form.Item style={{ marginBottom: 0, paddingTop: 30 }}>
                                  <Button
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                    disabled={fields.length <= 1}
                                  />
                                </Form.Item>
                              </Space>
                            ))}
                            <Button
                              type="dashed"
                              icon={<PlusOutlined />}
                              onClick={() =>
                                add({
                                  table_name: '',
                                  column_name: '',
                                  operator: 'eq',
                                  value_type: 'user_attribute',
                                  value: '',
                                  sort_order: fields.length,
                                })
                              }
                            >
                              {t('data_source_rls_add_rule')}
                            </Button>
                          </Space>
                        )}
                      </Form.List>

                      <Space style={{ marginTop: 16 }}>
                        <Button
                          type="primary"
                          htmlType="submit"
                          loading={createPolicy.isPending || updatePolicy.isPending}
                        >
                          {editingPolicy ? t('data_source_rls_update_policy') : t('data_source_rls_create_policy')}
                        </Button>
                        {editingPolicy ? (
                          <Button onClick={resetPolicyForm}>{t('cancel')}</Button>
                        ) : null}
                      </Space>
                    </Form>

                    <Table
                      rowKey="id"
                      size="small"
                      loading={policiesLoading || policiesFetching}
                      dataSource={policies}
                      columns={policyColumns}
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                      locale={{ emptyText: <Empty description={t('data_source_rls_policy_empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                    />
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Space>
    </Drawer>
  );
};

export default DataSourceAccessDrawer;
