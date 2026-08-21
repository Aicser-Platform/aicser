'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AutoComplete, Button, Card, Col, Empty, Input, Modal, Row, Select, Space, Spin, Switch, Tooltip, Typography, message } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DataSourceCLSPolicy, DataSourceCLSPolicyRequest, DataSourceCLSRuleRequest } from '@/api/dataSources';
import {
  useCreateDataSourceCLSPolicy,
  useDataSourceCLSPolicies,
  useDataSourceSchema,
  useUpdateDataSourceCLSPolicy,
} from '@/hooks/useDataSources';
import type { SchemaInfo } from '@/stores/useDataSourceStore';
import styles from './PolicyEditorPage.module.css';
import {
  CLS_ACTIONS,
  CLS_DRAFT_SESSION_PREFIX,
  CLS_MASK_STRATEGIES,
  EMPTY_COLUMN_RULE,
  buildColumnRulePayload,
  columnColumnOptionsFor,
  columnTableOptionsFor,
  seedColumnRule,
  type ColumnRuleFormValue,
} from './columnPolicyForm';

const { Text, Title } = Typography;

type ColumnPolicyFormState = {
  name: string;
  description: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  rules: ColumnRuleFormValue[];
};

const frameLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontSize: 13,
};

const seedState = (policy: DataSourceCLSPolicy | null): ColumnPolicyFormState => ({
  name: policy?.name ?? '',
  description: policy?.description ?? '',
  enabled: policy?.enabled ?? true,
  settings: policy?.settings ?? {},
  rules: policy?.rules?.length ? policy.rules.map(seedColumnRule) : [{ ...EMPTY_COLUMN_RULE }],
});

const sameState = (a: ColumnPolicyFormState, b: ColumnPolicyFormState) =>
  JSON.stringify(a) === JSON.stringify(b);

const ColumnPolicyEditorFrame: React.FC<{ children: React.ReactNode; footer?: React.ReactNode }> = ({
  children,
  footer,
}) => (
  <div className={styles.root}>
    <div className={styles.scroller}>
      <div className={styles.content}>{children}</div>
    </div>
    {footer ? <div className={styles.footer}>{footer}</div> : null}
  </div>
);

const ColumnRuleCard: React.FC<{
  index: number;
  rule: ColumnRuleFormValue;
  schema: SchemaInfo | null;
  canRemove: boolean;
  onChange: (rule: ColumnRuleFormValue) => void;
  onRemove: () => void;
}> = ({ index, rule, schema, canRemove, onChange, onRemove }) => {
  const t = useTranslations('data_source_detail');
  const tableOptions = columnTableOptionsFor(schema);
  const schemaAvailable = tableOptions.length > 0;
  const columnOptions = columnColumnOptionsFor(schema, rule.table_name);
  const action = rule.action ?? 'mask';
  const strategy = rule.mask_strategy ?? 'fixed';

  const set = <K extends keyof ColumnRuleFormValue>(key: K, value: ColumnRuleFormValue[K]) => {
    onChange({ ...rule, [key]: value });
  };

  return (
    <Card
      size="small"
      style={{ marginBottom: 10 }}
      title={<span style={{ fontSize: 13 }}>{t('rule_n', { n: index + 1 })}</span>}
      extra={
        <Tooltip title={canRemove ? undefined : t('policy_editor_last_rule_hint')}>
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!canRemove}
            onClick={onRemove}
          />
        </Tooltip>
      }
    >
      <Row gutter={[10, 12]}>
        <Col xs={24} sm={12} lg={5}>
          <Text style={frameLabelStyle}>{t('data_source_rls_table')}</Text>
          {schemaAvailable ? (
            <Select
              style={{ width: '100%' }}
              showSearch
              options={tableOptions}
              value={rule.table_name || undefined}
              onChange={(value) => set('table_name', value)}
            />
          ) : (
            <AutoComplete
              style={{ width: '100%' }}
              placeholder={t('data_source_rls_table')}
              value={rule.table_name}
              onChange={(value) => set('table_name', value)}
            />
          )}
        </Col>
        <Col xs={24} sm={12} lg={5}>
          <Text style={frameLabelStyle}>{t('data_source_rls_column')}</Text>
          {schemaAvailable ? (
            <Select
              style={{ width: '100%' }}
              showSearch
              options={columnOptions}
              value={rule.column_name || undefined}
              onChange={(value) => set('column_name', value)}
            />
          ) : (
            <AutoComplete
              style={{ width: '100%' }}
              placeholder={t('data_source_rls_column')}
              value={rule.column_name}
              onChange={(value) => set('column_name', value)}
            />
          )}
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Text style={frameLabelStyle}>{t('column_rule_action')}</Text>
          <Select
            style={{ width: '100%' }}
            value={action}
            onChange={(value) =>
              onChange({
                ...rule,
                action: value,
                mask_strategy: value === 'mask' ? rule.mask_strategy ?? 'fixed' : null,
              })
            }
            options={CLS_ACTIONS.map((value) => ({
              value,
              label: t(`column_rule_action_${value}`),
            }))}
          />
        </Col>
        <Col xs={12} sm={8} lg={5}>
          {action === 'mask' ? (
            <>
              <Text style={frameLabelStyle}>{t('column_rule_strategy')}</Text>
              <Select
                style={{ width: '100%' }}
                value={strategy}
                onChange={(value) => set('mask_strategy', value)}
                options={CLS_MASK_STRATEGIES.map((value) => ({
                  value,
                  label: t(`column_rule_strategy_${value}`),
                }))}
              />
            </>
          ) : null}
        </Col>
        <Col xs={12} sm={8} lg={4}>
          {action === 'mask' && strategy === 'partial' ? (
            <>
              <Text style={frameLabelStyle}>{t('column_rule_keep')}</Text>
              <Input
                inputMode="numeric"
                value={rule.keep}
                onChange={(event) => set('keep', event.target.value)}
              />
            </>
          ) : null}
        </Col>
      </Row>
      {action === 'deny' ? (
        <Alert type="warning" showIcon style={{ marginTop: 12 }} message={t('column_rule_deny_hint')} />
      ) : null}
    </Card>
  );
};

export const ColumnPolicyEditorPage: React.FC<{ dataSourceId: string; policyId?: string }> = ({
  dataSourceId,
  policyId,
}) => {
  const t = useTranslations('data_source_detail');
  const router = useRouter();
  const { policies, isLoading: policiesLoading } = useDataSourceCLSPolicies(dataSourceId, true);
  const { schema } = useDataSourceSchema(dataSourceId);
  const createPolicy = useCreateDataSourceCLSPolicy();
  const updatePolicy = useUpdateDataSourceCLSPolicy();
  const policy = useMemo(
    () => (policyId ? policies.find((item) => item.id === policyId) ?? null : null),
    [policies, policyId]
  );
  const [state, setState] = useState<ColumnPolicyFormState>(() => seedState(policy));
  const baseline = useRef<ColumnPolicyFormState>(seedState(policy));

  useEffect(() => {
    const next = seedState(policy);
    baseline.current = next;
    setState(next);
  }, [policy]);

  useEffect(() => {
    if (policyId || typeof window === 'undefined') return;
    const raw = window.sessionStorage.getItem(`${CLS_DRAFT_SESSION_PREFIX}${dataSourceId}`);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { rules?: DataSourceCLSRuleRequest[] };
      if (Array.isArray(parsed.rules) && parsed.rules.length) {
        setState((prev) => ({
          ...prev,
          name: prev.name || t('column_policy_suggested_name'),
          rules: parsed.rules!.map(seedColumnRule),
        }));
      }
    } catch {
      return;
    } finally {
      window.sessionStorage.removeItem(`${CLS_DRAFT_SESSION_PREFIX}${dataSourceId}`);
    }
  }, [dataSourceId, policyId, t]);

  const isDirty = !sameState(state, baseline.current);
  const isSaving = createPolicy.isPending || updatePolicy.isPending;
  const backHref = `/data/sources/${dataSourceId}?tab=column-rules`;
  const goBack = () => router.push(backHref);

  const setField = <K extends keyof ColumnPolicyFormState>(key: K, value: ColumnPolicyFormState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };
  const updateRule = (index: number, rule: ColumnRuleFormValue) => {
    setState((prev) => ({
      ...prev,
      rules: prev.rules.map((item, itemIndex) => (itemIndex === index ? rule : item)),
    }));
  };
  const addRule = () => {
    setState((prev) => ({ ...prev, rules: [...prev.rules, { ...EMPTY_COLUMN_RULE, sort_order: prev.rules.length }] }));
  };
  const removeRule = (index: number) => {
    setState((prev) => ({ ...prev, rules: prev.rules.filter((_item, itemIndex) => itemIndex !== index) }));
  };
  const payload = (): DataSourceCLSPolicyRequest => ({
    name: state.name.trim(),
    description: state.description.trim() || null,
    enabled: state.enabled,
    settings: state.settings,
    rules: state.rules.map(buildColumnRulePayload),
  });

  const handleCancel = () => {
    if (!isDirty) {
      goBack();
      return;
    }
    Modal.confirm({
      title: t('policy_editor_unsaved_title'),
      content: t('policy_editor_unsaved_content'),
      okText: t('policy_editor_discard'),
      cancelText: t('policy_editor_keep_editing'),
      okButtonProps: { danger: true },
      onOk: goBack,
    });
  };

  const handleSave = async () => {
    try {
      if (policy) {
        await updatePolicy.mutateAsync({ id: dataSourceId, policyId: policy.id, data: payload() });
      } else {
        await createPolicy.mutateAsync({ id: dataSourceId, data: payload() });
      }
      message.success(policy ? t('column_policy_updated') : t('column_policy_created'));
      goBack();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('column_policy_save_failed'));
    }
  };

  if (policyId && policiesLoading) {
    return (
      <ColumnPolicyEditorFrame>
        <div className={styles.loadingState}>
          <Spin />
        </div>
      </ColumnPolicyEditorFrame>
    );
  }

  if (policyId && !policy) {
    return (
      <ColumnPolicyEditorFrame>
        <div className={styles.emptyState}>
          <Empty description={t('data_source_access_no_cls_policy')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
            <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
              {t('policy_editor_cancel')}
            </Button>
          </Empty>
        </div>
      </ColumnPolicyEditorFrame>
    );
  }

  return (
    <ColumnPolicyEditorFrame
      footer={
        <div className={styles.footerInner}>
          <Space>
            <Button onClick={handleCancel}>{t('policy_editor_cancel')}</Button>
            <Button type="primary" loading={isSaving} onClick={handleSave}>
              {t('policy_editor_save')}
            </Button>
          </Space>
        </div>
      }
    >
      <header className={styles.header}>
        <Title level={2} className={styles.title}>
          {policy ? policy.name : t('column_policy_new')}
        </Title>
        <Text type="secondary" className={styles.description}>
          {t('data_source_access_column_policy')}
        </Text>
      </header>

      <div className={styles.body}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12} xl={9}>
            <Text style={frameLabelStyle}>{t('data_source_rls_policy_name')}</Text>
            <Input
              aria-label={t('data_source_rls_policy_name')}
              value={state.name}
              onChange={(event) => setField('name', event.target.value)}
            />
          </Col>
          <Col xs={24} md={12} xl={9}>
            <Text style={frameLabelStyle}>{t('data_source_rls_policy_description')}</Text>
            <Input value={state.description} onChange={(event) => setField('description', event.target.value)} />
          </Col>
          <Col xs={12} md={6} xl={3}>
            <Text style={frameLabelStyle}>{t('policy_active')}</Text>
            <div>
              <Switch checked={state.enabled} onChange={(next) => setField('enabled', next)} />
            </div>
          </Col>
        </Row>

        <Row gutter={[16, 16]} className={styles.editorGrid}>
          <Col xs={24}>
            {state.rules.map((rule, index) => (
              <ColumnRuleCard
                key={index}
                index={index}
                rule={rule}
                schema={schema}
                canRemove={state.rules.length > 1}
                onChange={(next) => updateRule(index, next)}
                onRemove={() => removeRule(index)}
              />
            ))}
            <Button icon={<PlusOutlined />} onClick={addRule}>
              {t('data_source_rls_add_rule')}
            </Button>
          </Col>
        </Row>
      </div>
    </ColumnPolicyEditorFrame>
  );
};

export default ColumnPolicyEditorPage;
