'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { SchemaInfo } from '@/stores/useDataSourceStore';
import AccessSentence from './AccessSentence';
import { attributePathFor, unresolvedForRule } from './accessSentence';
import type {
  DataSourceRLSOperator,
  DataSourceRLSPolicy,
  DataSourceRLSPolicyRequest,
  DataSourceRLSRuleRequest,
  DataSourceRLSValueType,
} from '@/api/dataSources';
import {
  useCreateDataSourceRLSPolicy,
  useDataSourceRLSProjectAttributes,
  useDataSourceSchema,
  usePreviewDataSourceRLSPolicy,
  useUpdateDataSourceRLSPolicy,
  useUpdateDataSourceRLSProjectAttribute,
} from '@/hooks/useDataSources';
import { useGranteeDirectory } from '@/hooks/access/useGranteeOptions';
import { useOrganizationStore } from '@/stores/useOrganizationStore';

const { Text } = Typography;

export const RLS_OPERATORS: DataSourceRLSOperator[] = ['eq', 'in', 'not_in', 'between', 'is_null', 'is_not_null'];

export const RLS_VALUE_TYPES: DataSourceRLSValueType[] = [
  'fixed',
  'user_attribute',
  'group_attribute',
  'org_attribute',
  'project_attribute',
];

export type RuleFormValue = {
  table_name: string;
  column_name: string;
  operator: DataSourceRLSOperator;
  value_type: DataSourceRLSValueType;
  value?: string;
  sort_order?: number;
};

const NULL_OPERATORS: DataSourceRLSOperator[] = ['is_null', 'is_not_null'];
const LIST_OPERATORS: DataSourceRLSOperator[] = ['in', 'not_in', 'between'];

export const isNullOperator = (operator: DataSourceRLSOperator) => NULL_OPERATORS.includes(operator);

export const tableOptionsFor = (schema: SchemaInfo | null) =>
  (schema?.tables ?? []).map((table) => ({ value: table.name, label: table.name }));

export const columnOptionsFor = (schema: SchemaInfo | null, tableName: string) => {
  const table = (schema?.tables ?? []).find((item) => item.name === tableName);
  return (table?.columns ?? []).map((column) => ({
    value: column.name,
    label: `${column.name} · ${column.type}`,
  }));
};

export const buildRulePayload = (rule: RuleFormValue): DataSourceRLSRuleRequest => {
  const raw = String(rule.value ?? '').trim();
  let value: unknown;

  if (isNullOperator(rule.operator)) {
    value = null;
  } else if (rule.value_type !== 'fixed') {
    value = raw;
  } else if (!raw) {
    value = null;
  } else if (LIST_OPERATORS.includes(rule.operator)) {
    value = raw.split(',').map((item) => item.trim()).filter(Boolean);
  } else {
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
  }

  return {
    table_name: rule.table_name.trim(),
    column_name: rule.column_name.trim(),
    operator: rule.operator,
    value_type: rule.value_type,
    value,
    sort_order: Number(rule.sort_order ?? 0),
  };
};

/**
 * Keys _load_user_attributes actually populates. The list is an assist, not a
 * gate — the Select stays free-entry so dotted paths (settings.region) work.
 */
const USER_ATTRIBUTE_KEYS = [
  'email',
  'username',
  'first_name',
  'last_name',
  'role',
  'status',
  'tenant_id',
  'company',
  'location',
  'timezone',
  'job_role',
  'industry',
  'organization_id',
  'project_id',
];

/**
 * Project and org attribute keys are whatever has been stored for that scope,
 * so they come from the attributes endpoint rather than a hardcoded guess —
 * offering keys that do not resolve is what produced "Unresolved attribute:
 * project.name". User attributes are fixed by _load_user_attributes.
 */
export const attributeKeyOptions = (
  valueType: DataSourceRLSValueType,
  scopedKeys: string[] = []
) => {
  if (valueType === 'fixed') return [];
  if (valueType === 'user_attribute') {
    return USER_ATTRIBUTE_KEYS.map((value) => ({ value, label: value }));
  }
  return scopedKeys.map((value) => ({ value, label: value }));
};


// Identity clients actually use is the viewer's email, not a synthetic customer id.
export const EMPTY_RULE: RuleFormValue = {
  table_name: '',
  column_name: '',
  operator: 'eq',
  value_type: 'user_attribute',
  value: 'email',
  sort_order: 0,
};

type PreviewState = {
  predicate?: string | null;
  effect?: string;
  unresolved: string[];
  masked: boolean;
  failed: boolean;
};

const EMPTY_PREVIEW: PreviewState = { unresolved: [], masked: false, failed: false };

export const RLSPolicyModal: React.FC<{
  open: boolean;
  dataSourceId: string;
  policy: DataSourceRLSPolicy | null;
  onClose: () => void;
}> = ({ open, dataSourceId, policy, onClose }) => {
  const t = useTranslations('data_source_detail');
  const [form] = Form.useForm<{
    name: string;
    description?: string;
    enabled: boolean;
    default_deny: boolean;
    rules: RuleFormValue[];
  }>();
  const { schema } = useDataSourceSchema(open ? dataSourceId : null);
  const createPolicy = useCreateDataSourceRLSPolicy();
  const updatePolicy = useUpdateDataSourceRLSPolicy();
  const previewPolicy = usePreviewDataSourceRLSPolicy();
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const [simulateProjectId, setSimulateProjectId] = useState<string | undefined>();
  const [simulateUserId, setSimulateUserId] = useState<string | undefined>();
  const [attributeDraft, setAttributeDraft] = useState<Record<string, string>>({});
  const [attributeFocus, setAttributeFocus] = useState('');

  const currentOrganization = useOrganizationStore((state) => state.currentOrganization);
  const organizationId = currentOrganization?.id ? String(currentOrganization.id) : null;
  const { optionsByType } = useGranteeDirectory({ organizationId, enabled: open });
  const { attributes: projectAttributes } = useDataSourceRLSProjectAttributes(
    dataSourceId,
    simulateProjectId,
    open
  );
  const updateProjectAttribute = useUpdateDataSourceRLSProjectAttribute();
  const projectAttributeKeys = projectAttributes.map((attribute) => attribute.key);

  const rules = (Form.useWatch('rules', form) ?? []) as RuleFormValue[];
  const defaultDeny = Form.useWatch('default_deny', form) as boolean | undefined;
  const schemaTables = tableOptionsFor(schema);
  const schemaAvailable = schemaTables.length > 0;
  // A fixed-value policy resolves on its own; only attribute rules need someone
  // to resolve against, so only those should ask for a preview context.
  const needsPreviewContext = (rules ?? []).some((rule) => Boolean(attributePathFor(rule ?? {})));
  const hasPreviewContext = Boolean(simulateProjectId || simulateUserId) || !needsPreviewContext;

  useEffect(() => {
    if (!open) return;
    setPreview(EMPTY_PREVIEW);
    setAttributeDraft({});
    setAttributeFocus('');
    form.setFieldsValue(
      policy
        ? {
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
                  value: Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value ?? ''),
                  sort_order: rule.sort_order,
                }))
              : [EMPTY_RULE],
          }
        : { name: '', description: '', enabled: true, default_deny: true, rules: [EMPTY_RULE] }
    );
  }, [form, open, policy]);

  // Debounced live preview — the predicate updates as the rules are built.
  const rulesKey = JSON.stringify(rules);
  useEffect(() => {
    if (!open || !rules.length) return undefined;
    const timer = setTimeout(async () => {
      try {
        const response = await previewPolicy.mutateAsync({
          id: dataSourceId,
          data: {
            rules: rules.map(buildRulePayload),
            default_deny: Boolean(defaultDeny),
            simulate_project_id: simulateProjectId ?? null,
            simulate_user_id: simulateUserId ?? null,
          },
        });
        setPreview({
          predicate: response.predicate,
          effect: response.effect,
          unresolved: response.unresolved ?? [],
          masked: Boolean(response.masked),
          failed: false,
        });
      } catch {
        setPreview({ ...EMPTY_PREVIEW, failed: true });
      }
    }, 400);
    return () => clearTimeout(timer);
    // previewPolicy is a stable mutation object; excluding it avoids a re-fire loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSourceId, defaultDeny, open, rulesKey, simulateProjectId, simulateUserId]);

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload: DataSourceRLSPolicyRequest = {
      name: values.name.trim(),
      description: values.description?.trim() || null,
      enabled: Boolean(values.enabled),
      default_deny: Boolean(values.default_deny),
      settings: {},
      rules: values.rules.map((rule, index) => ({ ...buildRulePayload(rule), sort_order: index })),
    };
    try {
      if (policy) {
        await updatePolicy.mutateAsync({ id: dataSourceId, policyId: policy.id, data: payload });
        message.success(t('data_source_rls_policy_updated'));
      } else {
        await createPolicy.mutateAsync({ id: dataSourceId, data: payload });
        message.success(t('data_source_rls_policy_created'));
      }
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('data_source_rls_policy_save_failed'));
    }
  };

  // Disabling a policy compiles to WHERE 1 = 0 rather than "no filtering",
  // so the confirm spells out what actually happens.
  const handleActiveChange = (next: boolean) => {
    if (next) {
      form.setFieldsValue({ enabled: true });
      return;
    }
    Modal.confirm({
      title: t('policy_active'),
      content: t('policy_active_off_confirm'),
      onOk: () => form.setFieldsValue({ enabled: false }),
      onCancel: () => form.setFieldsValue({ enabled: true }),
    });
  };

  const effectColor = (effect?: string) =>
    effect === 'deny_all' ? 'red' : effect === 'filtered' ? 'green' : 'orange';

  return (
    <Modal
      open={open}
      width={1080}
      title={policy ? policy.name : t('policy_new')}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={createPolicy.isPending || updatePolicy.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={9}>
            <Form.Item name="name" label={t('data_source_rls_policy_name')} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={9}>
            <Form.Item name="description" label={t('data_source_rls_policy_description')}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={3}>
            <Form.Item name="enabled" label={t('policy_active')} valuePropName="checked">
              <Switch onChange={handleActiveChange} />
            </Form.Item>
          </Col>
          <Col span={3}>
            <Form.Item
              name="default_deny"
              label={t('data_source_rls_default_deny')}
              valuePropName="checked"
              tooltip={t('default_deny_help')}
            >
              <Switch />
            </Form.Item>
          </Col>
        </Row>

        {/* Preview context sits above the rules, because nothing below it can
            be judged without knowing who it is being evaluated for. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px',
            marginBottom: 16,
            borderRadius: 8,
            background: 'var(--color-bg-subtle, rgba(0,0,0,0.02))',
            border: '1px solid var(--color-border, rgba(0,0,0,0.06))',
          }}
        >
          <Text strong style={{ fontSize: 13 }}>{t('preview_as')}</Text>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 200 }}
            placeholder={t('data_source_rls_preview_project_placeholder')}
            value={simulateProjectId}
            onChange={setSimulateProjectId}
            options={optionsByType.project.map((o) => ({ value: o.value, label: o.label }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 200 }}
            placeholder={t('preview_as_user')}
            value={simulateUserId}
            onChange={setSimulateUserId}
            options={optionsByType.user.map((o) => ({ value: o.value, label: o.label }))}
          />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {!hasPreviewContext ? (
              <Text type="secondary" style={{ fontSize: 13 }}>{t('preview_needs_context')}</Text>
            ) : preview.failed ? (
              <Text type="warning" style={{ fontSize: 13 }}>{t('preview_unavailable')}</Text>
            ) : preview.effect ? (
              <>
                <Tag color={effectColor(preview.effect)} style={{ margin: 0 }}>
                  {t(`effect_${preview.effect}`)}
                </Tag>
                {preview.predicate ? (
                  <Text code style={{ fontSize: 12 }}>{preview.predicate}</Text>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {preview.masked ? (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('preview_masked')} />
        ) : null}
        {!schemaAvailable ? (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('schema_unavailable')} />
        ) : null}

        <Form.List name="rules">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field, index) => {
                const rule = rules[field.name];
                const operator = rule?.operator ?? 'eq';
                const valueType = rule?.value_type ?? 'user_attribute';
                const columnOptions = columnOptionsFor(schema, rule?.table_name ?? '');
                const unresolvedPath = hasPreviewContext
                  ? unresolvedForRule(rule ?? {}, preview.unresolved)
                  : '';
                return (
                  <Card
                    key={field.key}
                    size="small"
                    style={{ marginBottom: 10 }}
                    title={<span style={{ fontSize: 13 }}>{t('rule_n', { n: index + 1 })}</span>}
                    extra={
                      fields.length > 1 ? (
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => remove(field.name)}
                        />
                      ) : null
                    }
                  >
                    <Row gutter={10}>
                      <Col span={5}>
                        <Form.Item
                          name={[field.name, 'table_name']}
                          label={t('data_source_rls_table')}
                          rules={[{ required: true }]}
                          style={{ marginBottom: 8 }}
                        >
                          {schemaAvailable ? (
                            <Select options={schemaTables} showSearch />
                          ) : (
                            <AutoComplete placeholder={t('data_source_rls_table')} />
                          )}
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          name={[field.name, 'column_name']}
                          label={t('data_source_rls_column')}
                          rules={[{ required: true }]}
                          style={{ marginBottom: 8 }}
                        >
                          {schemaAvailable ? (
                            <Select options={columnOptions} showSearch />
                          ) : (
                            <AutoComplete placeholder={t('data_source_rls_column')} />
                          )}
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item
                          name={[field.name, 'operator']}
                          label={t('data_source_rls_operator')}
                          style={{ marginBottom: 8 }}
                        >
                          <Select
                            options={RLS_OPERATORS.map((value) => ({
                              value,
                              label: t(`data_source_rls_operator_${value}`),
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item
                          name={[field.name, 'value_type']}
                          label={t('data_source_rls_value_type')}
                          style={{ marginBottom: 8 }}
                        >
                          <Select
                            options={RLS_VALUE_TYPES.map((value) => ({
                              value,
                              label: t(`data_source_rls_value_type_${value}`),
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        {!isNullOperator(operator) ? (
                          <Form.Item
                            name={[field.name, 'value']}
                            label={valueType === 'fixed' ? t('data_source_rls_value') : t('attribute_key_label')}
                            style={{ marginBottom: 8 }}
                          >
                            {valueType === 'fixed' ? (
                              <Input placeholder={t('data_source_rls_value_fixed_placeholder')} />
                            ) : (
                              <Select
                                showSearch
                                allowClear
                                placeholder={t('data_source_rls_value_attribute_placeholder')}
                                options={attributeKeyOptions(valueType, projectAttributeKeys)}
                              />
                            )}
                          </Form.Item>
                        ) : null}
                      </Col>
                    </Row>

                    <AccessSentence rule={rule ?? {}} />

                    {unresolvedPath ? (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginTop: 8 }}
                        message={t('rule_unresolved', { path: unresolvedPath })}
                        action={
                          simulateProjectId && valueType === 'project_attribute' ? (
                            <Button size="small" onClick={() => setAttributeFocus(String(rule?.value ?? ''))}>
                              {t('set_attribute_value')}
                            </Button>
                          ) : null
                        }
                      />
                    ) : null}
                  </Card>
                );
              })}
              <Button icon={<PlusOutlined />} onClick={() => add({ ...EMPTY_RULE, sort_order: fields.length })}>
                {t('data_source_rls_add_rule')}
              </Button>
            </>
          )}
        </Form.List>

        {simulateProjectId && projectAttributes.length > 0 ? (
          <Card size="small" style={{ marginTop: 16 }} title={t('project_attribute_values')}>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              {projectAttributes.map((attribute) => (
                <Space.Compact key={attribute.key} style={{ width: '100%' }}>
                  <Input
                    style={{ width: '35%' }}
                    value={attribute.key}
                    disabled
                    status={attributeFocus === attribute.key ? 'warning' : undefined}
                  />
                  <Input
                    style={{ width: '45%' }}
                    value={attributeDraft[attribute.key] ?? attribute.value_preview}
                    onChange={(event) =>
                      setAttributeDraft((draft) => ({ ...draft, [attribute.key]: event.target.value }))
                    }
                  />
                  <Button
                    onClick={async () => {
                      try {
                        await updateProjectAttribute.mutateAsync({
                          id: dataSourceId,
                          projectId: simulateProjectId,
                          key: attribute.key,
                          value: (attributeDraft[attribute.key] ?? attribute.value_preview).trim(),
                        });
                        message.success(t('data_source_rls_project_attribute_saved'));
                      } catch (error) {
                        message.error(
                          error instanceof Error
                            ? error.message
                            : t('data_source_rls_project_attribute_save_failed')
                        );
                      }
                    }}
                  >
                    {t('data_source_rls_save_project_attribute')}
                  </Button>
                </Space.Compact>
              ))}
            </Space>
          </Card>
        ) : null}
      </Form>
    </Modal>
  );
};

export default RLSPolicyModal;
