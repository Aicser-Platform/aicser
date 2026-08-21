'use client';

import React, { useMemo, useState } from 'react';
import { Button, Col, Empty, Modal, Row, Space, Spin, Typography, message } from 'antd';
import { ArrowLeftOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  useDataSourceRLSPolicies,
  useDataSourceRLSProjectAttributes,
  useDataSourceSchema,
} from '@/hooks/useDataSources';
import { PolicyForm } from './PolicyForm';
import { RuleCard } from './RuleCard';
import { PreviewPanel } from './PreviewPanel';
import { usePolicyForm } from './usePolicyForm';
import styles from './PolicyEditorPage.module.css';

const { Text, Title } = Typography;

const PolicyEditorFrame: React.FC<{
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ children, footer }) => (
  <div className={styles.root}>
    <div className={styles.scroller}>
      <div className={styles.content}>{children}</div>
    </div>
    {footer ? <div className={styles.footer}>{footer}</div> : null}
  </div>
);

/**
 * Full-page row-filter policy editor — replaces the old modal. Rules on the
 * left, a sticky simulate-as preview on the right, name/description/toggles
 * above both, save/cancel pinned to the bottom.
 *
 * `policyId` absent means "new policy"; present means "edit" — either way the
 * existing policy list cache (`useDataSourceRLSPolicies`) is reused to find
 * it rather than fetching a policy-by-id endpoint that doesn't exist.
 */
export const PolicyEditorPage: React.FC<{ dataSourceId: string; policyId?: string }> = ({
  dataSourceId,
  policyId,
}) => {
  const t = useTranslations('data_source_detail');
  const router = useRouter();

  const { policies, isLoading: policiesLoading } = useDataSourceRLSPolicies(dataSourceId, true);
  const policy = useMemo(
    () => (policyId ? policies.find((item) => item.id === policyId) ?? null : null),
    [policies, policyId]
  );

  const { schema } = useDataSourceSchema(dataSourceId);

  const { state, isDirty, isSaving, setField, updateRule, addRule, removeRule, save } = usePolicyForm({
    dataSourceId,
    policy,
  });

  // Lifted out of PreviewPanel: RuleCard's project-attribute dropdown needs
  // the simulated project id too, so the page has to own it rather than
  // letting the preview rail keep it as private state.
  const [simulateProjectId, setSimulateProjectId] = useState<string | undefined>();
  const [simulateUserId, setSimulateUserId] = useState<string | undefined>();

  const { attributes } = useDataSourceRLSProjectAttributes(dataSourceId, simulateProjectId);
  const projectAttributeKeys = useMemo(() => attributes.map((attribute) => attribute.key), [attributes]);

  const backHref = `/data/sources/${dataSourceId}?tab=row-filters`;
  const goBack = () => router.push(backHref);

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
      await save();
      message.success(policy ? t('data_source_rls_policy_updated') : t('data_source_rls_policy_created'));
      goBack();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('data_source_rls_policy_save_failed'));
    }
  };

  if (policyId && policiesLoading) {
    return (
      <PolicyEditorFrame>
        <div className={styles.loadingState}>
          <Spin />
        </div>
      </PolicyEditorFrame>
    );
  }

  if (policyId && !policy) {
    return (
      <PolicyEditorFrame>
        <div className={styles.emptyState}>
          <Empty description={t('data_source_access_no_rls_policy')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
            <Button icon={<ArrowLeftOutlined />} onClick={goBack}>
              {t('policy_editor_cancel')}
            </Button>
          </Empty>
        </div>
      </PolicyEditorFrame>
    );
  }

  return (
    <PolicyEditorFrame
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
          {policy ? policy.name : t('policy_new')}
        </Title>
        <Text type="secondary" className={styles.description}>
          {t('data_source_access_rls_policy')}
        </Text>
      </header>

      <div className={styles.body}>
        <PolicyForm state={state} setField={setField} />

        <Row gutter={[16, 16]} className={styles.editorGrid}>
          <Col xs={24} xl={17} xxl={18}>
            {state.rules.map((rule, index) => (
              <RuleCard
                key={index}
                index={index}
                rule={rule}
                schema={schema}
                projectAttributeKeys={projectAttributeKeys}
                canRemove={state.rules.length > 1}
                onChange={(next) => updateRule(index, next)}
                onRemove={() => removeRule(index)}
              />
            ))}
            <Button icon={<PlusOutlined />} onClick={addRule}>
              {t('data_source_rls_add_rule')}
            </Button>
          </Col>
          <Col xs={24} xl={7} xxl={6}>
            <div className={styles.previewRail}>
              <PreviewPanel
                dataSourceId={dataSourceId}
                rules={state.rules}
                defaultDeny={state.defaultDeny}
                simulateProjectId={simulateProjectId}
                simulateUserId={simulateUserId}
                onSimulateProjectIdChange={setSimulateProjectId}
                onSimulateUserIdChange={setSimulateUserId}
              />
            </div>
          </Col>
        </Row>
      </div>
    </PolicyEditorFrame>
  );
};

export default PolicyEditorPage;
