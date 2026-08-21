'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Collapse, Drawer, Space, Spin, Tag, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { DataSourceAccessGrant, DataSourceCLSPolicy, DataSourceRLSPolicy } from '@/api/dataSources';
import { usePreviewDataSourceRLSPolicy } from '@/hooks/useDataSources';
import { accessLevelFor, type AccessLevelKey } from './GrantShareBar';
import AccessSentence from './AccessSentence';
import { grantEffect, EFFECT_TONE } from './grantEffect';

const { Text, Title } = Typography;

type PreviewState = {
  status: 'idle' | 'loading' | 'success' | 'failed';
  predicate?: string | null;
  effect?: string;
  unresolved: string[];
  masked: boolean;
};

const EMPTY_PREVIEW: PreviewState = { status: 'idle', unresolved: [], masked: false };

const effectColor = (effect?: string) =>
  effect === 'deny_all' ? 'red' : effect === 'filtered' ? 'green' : 'orange';

const LEVEL_DESCRIPTION_KEY: Record<AccessLevelKey, string> = {
  view: 'effective_access_level_view_desc',
  explore: 'effective_access_level_explore_desc',
  manage: 'effective_access_level_manage_desc',
  custom: 'effective_access_level_custom_desc',
};

/**
 * "What does this grant actually let them do?" for one grantee, in plain
 * language — the level they hold, the rows they see, the rules behind that,
 * and (where it can be resolved) the compiled SQL predicate.
 *
 * `grantee_type === 'org_role' | 'project_role' | 'group'` has no single
 * user or project to simulate, so the compiled predicate can't be resolved
 * for it — we say so explicitly rather than show an empty predicate, which
 * would read as "no filter applied" and is exactly the misunderstanding
 * this drawer exists to prevent.
 */
export const EffectiveAccessDrawer: React.FC<{
  open: boolean;
  onClose: () => void;
  dataSourceId: string;
  grant: DataSourceAccessGrant | null;
  policies: DataSourceRLSPolicy[];
  columnPolicies?: DataSourceCLSPolicy[];
  granteeLabel: string;
}> = ({ open, onClose, dataSourceId, grant, policies, columnPolicies = [], granteeLabel }) => {
  const t = useTranslations('data_source_detail');
  const previewPolicy = usePreviewDataSourceRLSPolicy();
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);

  const effect = grant ? grantEffect(grant, policies) : null;
  const policy = grant?.rls_policy_id ? policies.find((item) => item.id === grant.rls_policy_id) : undefined;
  const columnPolicy = grant?.cls_policy_id
    ? columnPolicies.find((item) => item.id === grant.cls_policy_id)
    : undefined;
  const canSimulate = grant?.grantee_type === 'project' || grant?.grantee_type === 'user';

  useEffect(() => {
    if (!open || !grant || !policy || effect?.kind !== 'filtered' || !canSimulate) {
      setPreview(EMPTY_PREVIEW);
      return undefined;
    }

    let cancelled = false;
    setPreview({ ...EMPTY_PREVIEW, status: 'loading' });

    (async () => {
      try {
        const response = await previewPolicy.mutateAsync({
          id: dataSourceId,
          data: {
            rules: policy.rules,
            default_deny: policy.default_deny,
            simulate_project_id: grant.grantee_type === 'project' ? grant.grantee_id : null,
            simulate_user_id: grant.grantee_type === 'user' ? grant.grantee_id : null,
          },
        });
        if (cancelled) return;
        setPreview({
          status: 'success',
          predicate: response.predicate,
          effect: response.effect,
          unresolved: response.unresolved ?? [],
          masked: Boolean(response.masked),
        });
      } catch {
        if (!cancelled) setPreview({ ...EMPTY_PREVIEW, status: 'failed' });
      }
    })();

    return () => {
      cancelled = true;
    };
    // previewPolicy is a stable mutation object; excluding it avoids a re-fire loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, grant?.id, policy?.id, effect?.kind, canSimulate, dataSourceId]);

  if (!grant || !effect) {
    return <Drawer open={open} onClose={onClose} title={t('effective_access_title')} width={480} />;
  }

  const level = accessLevelFor(grant.permissions);

  return (
    <Drawer open={open} onClose={onClose} title={t('effective_access_title')} width={480}>
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('effective_access_grantee_label')}
          </Text>
          <div>
            <Space size={8}>
              <Text strong>{granteeLabel}</Text>
              <Tag>{t(`data_source_access_grantee_${grant.grantee_type}`)}</Tag>
            </Space>
          </div>
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('effective_access_level_label')}
          </Text>
          <div style={{ marginTop: 4 }}>
            {level === 'custom' ? (
              <Space size={4} wrap>
                {grant.permissions.map((permission) => (
                  <Tag key={permission}>{t(`data_source_access_permission_${permission}`)}</Tag>
                ))}
              </Space>
            ) : (
              <Tag color="blue">{t(`data_source_access_level_${level}`)}</Tag>
            )}
          </div>
          <Text style={{ fontSize: 13 }} type="secondary">
            {t(LEVEL_DESCRIPTION_KEY[level])}
          </Text>
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('effective_access_rows_label')}
          </Text>
          <div style={{ marginTop: 4 }}>
            <Space size={8} wrap align="start">
              <Tag color={EFFECT_TONE[effect.kind].color}>{t(EFFECT_TONE[effect.kind].key)}</Tag>
              {effect.kind === 'filtered' && policy ? <Text strong>{policy.name}</Text> : null}
              {effect.kind === 'all_rows' ? (
                <Tag color="warning" icon={<WarningOutlined />} style={{ margin: 0 }}>
                  {t('row_access_all_rows')}
                </Tag>
              ) : null}
            </Space>
          </div>
          {effect.kind === 'metadata_only' ? (
            <Text style={{ fontSize: 13 }} type="secondary">
              {t('row_access_not_applicable')}
            </Text>
          ) : null}
          {effect.kind === 'all_rows' ? (
            <Text style={{ fontSize: 13 }} type="warning">
              {t('effect_all_rows_detail')}
            </Text>
          ) : null}
          {effect.kind === 'denies_all' ? (
            <Text style={{ fontSize: 13 }} type="danger">
              {t('effect_deny_all_detail')}
            </Text>
          ) : null}
        </div>

        {effect.rules.length > 0 ? (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('effective_access_rules_label')}
            </Text>
            <Space direction="vertical" size={6} style={{ marginTop: 4, width: '100%' }}>
              {effect.rules.map((rule) => (
                <AccessSentence key={rule.id} rule={rule} tone="normal" />
              ))}
            </Space>
          </div>
        ) : null}

        {grant.permissions.includes('query') ? (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('effective_access_columns_label')}
            </Text>
            <div style={{ marginTop: 4 }}>
              {columnPolicy ? (
                <Space size={[4, 4]} wrap>
                  {columnPolicy.rules.map((rule) => (
                    <Tag key={rule.id} color={rule.action === 'deny' ? 'red' : 'blue'}>
                      {rule.action === 'deny'
                        ? t('column_rule_summary_deny', {
                            column: `${rule.table_name}.${rule.column_name}`,
                          })
                        : t('column_rule_summary_mask', {
                            column: `${rule.table_name}.${rule.column_name}`,
                            strategy: t(`column_rule_strategy_${rule.mask_strategy ?? 'fixed'}`),
                          })}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Tag color="warning">{t('column_access_all_columns')}</Tag>
              )}
            </div>
          </div>
        ) : null}

        {effect.kind === 'filtered' ? (
          <div>
            {!canSimulate ? (
              <Alert type="warning" showIcon message={t('effective_access_role_grantee_warning')} />
            ) : (
              <Collapse
                size="small"
                ghost
                defaultActiveKey={['predicate']}
                items={[
                  {
                    key: 'predicate',
                    label: (
                      <Title level={5} style={{ margin: 0, fontSize: 13 }}>
                        {t('data_source_rls_preview_predicate')}
                      </Title>
                    ),
                    children:
                      preview.status === 'loading' ? (
                        <Spin size="small" />
                      ) : preview.status === 'failed' ? (
                        <Text type="warning" style={{ fontSize: 13 }}>
                          {t('preview_unavailable')}
                        </Text>
                      ) : (
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                          {preview.masked ? (
                            <Alert type="info" showIcon message={t('preview_masked')} />
                          ) : null}
                          {preview.unresolved.map((path) => (
                            <Alert
                              key={path}
                              type="warning"
                              showIcon
                              message={t('preview_unresolved', { path })}
                            />
                          ))}
                          {preview.effect ? (
                            <Tag color={effectColor(preview.effect)} style={{ margin: 0 }}>
                              {t(`effect_${preview.effect}`)}
                            </Tag>
                          ) : null}
                          {preview.predicate ? (
                            <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>
                              {preview.predicate}
                            </Text>
                          ) : (
                            <Text type="secondary" style={{ fontSize: 13 }}>
                              {t('data_source_rls_preview_empty')}
                            </Text>
                          )}
                        </Space>
                      ),
                  },
                ]}
              />
            )}
          </div>
        ) : null}
      </Space>
    </Drawer>
  );
};

export default EffectiveAccessDrawer;
