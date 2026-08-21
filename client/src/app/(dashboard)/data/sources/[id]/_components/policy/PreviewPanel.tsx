'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Select, Space, Tag, Typography, message } from 'antd';
import { useTranslations } from 'next-intl';
import { attributePathFor } from '../accessSentence';
import { buildRulePayload, type RuleFormValue } from './policyForm';
import {
  useDataSourceRLSProjectAttributes,
  usePreviewDataSourceRLSPolicy,
  useUpdateDataSourceRLSProjectAttribute,
} from '@/hooks/useDataSources';
import { useGranteeDirectory } from '@/hooks/access/useGranteeOptions';
import { useOrganizationStore } from '@/stores/useOrganizationStore';

const { Text, Title } = Typography;

type PreviewState = {
  predicate?: string | null;
  effect?: string;
  unresolved: string[];
  masked: boolean;
  failed: boolean;
};

const EMPTY_PREVIEW: PreviewState = { unresolved: [], masked: false, failed: false };

const effectColor = (effect?: string) =>
  effect === 'deny_all' ? 'red' : effect === 'filtered' ? 'green' : 'orange';

/**
 * "Preview as" project/user selectors plus the predicate the draft resolves
 * to for that context. `simulateProjectId`/`simulateUserId` are controlled by
 * the parent (PolicyEditorPage needs the project id to populate RuleCard's
 * attribute dropdowns) — everything else (the preview result, the attribute
 * edit draft) is scratch for exploring the draft and stays local.
 */
export const PreviewPanel: React.FC<{
  dataSourceId: string;
  rules: RuleFormValue[];
  defaultDeny: boolean;
  simulateProjectId: string | undefined;
  simulateUserId: string | undefined;
  onSimulateProjectIdChange: (projectId: string | undefined) => void;
  onSimulateUserIdChange: (userId: string | undefined) => void;
}> = ({
  dataSourceId,
  rules,
  defaultDeny,
  simulateProjectId,
  simulateUserId,
  onSimulateProjectIdChange,
  onSimulateUserIdChange,
}) => {
  const t = useTranslations('data_source_detail');
  const previewPolicy = usePreviewDataSourceRLSPolicy();
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const [attributeDraft, setAttributeDraft] = useState<Record<string, string>>({});
  const [attributeFocus, setAttributeFocus] = useState('');

  const currentOrganization = useOrganizationStore((state) => state.currentOrganization);
  const organizationId = currentOrganization?.id ? String(currentOrganization.id) : null;
  const { optionsByType } = useGranteeDirectory({ organizationId, enabled: true });
  const { attributes: projectAttributes } = useDataSourceRLSProjectAttributes(
    dataSourceId,
    simulateProjectId,
    true
  );
  const updateProjectAttribute = useUpdateDataSourceRLSProjectAttribute();

  // A fixed-value policy resolves on its own; only attribute rules need someone
  // to resolve against, so only those should ask for a preview context.
  const needsPreviewContext = rules.some((rule) => Boolean(attributePathFor(rule ?? {})));
  const hasPreviewContext = Boolean(simulateProjectId || simulateUserId) || !needsPreviewContext;

  // Debounced live preview — the predicate updates as the rules are built.
  const rulesKey = JSON.stringify(rules);
  useEffect(() => {
    if (!rules.length) {
      setPreview(EMPTY_PREVIEW);
      return undefined;
    }
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
  }, [dataSourceId, defaultDeny, rulesKey, simulateProjectId, simulateUserId]);

  return (
    <Card size="small">
      <Title level={5} style={{ marginTop: 0, marginBottom: 12 }}>
        {t('data_source_rls_preview')}
      </Title>

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
        <Text strong style={{ fontSize: 13 }}>
          {t('preview_as')}
        </Text>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 200 }}
          placeholder={t('data_source_rls_preview_project_placeholder')}
          value={simulateProjectId}
          onChange={onSimulateProjectIdChange}
          options={optionsByType.project.map((option) => ({ value: option.value, label: option.label }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 200 }}
          placeholder={t('preview_as_user')}
          value={simulateUserId}
          onChange={onSimulateUserIdChange}
          options={optionsByType.user.map((option) => ({ value: option.value, label: option.label }))}
        />
        {hasPreviewContext ? (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {preview.failed ? (
              <Text type="warning" style={{ fontSize: 13 }}>
                {t('preview_unavailable')}
              </Text>
            ) : preview.effect ? (
              <>
                <Tag color={effectColor(preview.effect)} style={{ margin: 0 }}>
                  {t(`effect_${preview.effect}`)}
                </Tag>
                {preview.predicate ? (
                  <Text code style={{ fontSize: 12 }}>
                    {preview.predicate}
                  </Text>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {preview.masked ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('preview_masked')} />
      ) : null}

      {!hasPreviewContext ? (
        <Empty
          description={t('preview_empty_state')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ padding: '32px 0' }}
        />
      ) : (
        <>
          {preview.unresolved.length ? (
            <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }} size={4}>
              {preview.unresolved.map((path) => (
                <Alert
                  key={path}
                  type="warning"
                  showIcon
                  message={t('preview_unresolved', { path })}
                />
              ))}
            </Space>
          ) : null}

          {simulateProjectId && projectAttributes.length > 0 ? (
            <Card size="small" style={{ marginTop: 4 }} title={t('project_attribute_values')}>
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
                          setAttributeFocus('');
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
        </>
      )}
    </Card>
  );
};

export default PreviewPanel;
