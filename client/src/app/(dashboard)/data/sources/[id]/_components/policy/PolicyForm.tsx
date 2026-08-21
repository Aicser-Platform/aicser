'use client';

import React from 'react';
import { Col, Input, Modal, Row, Switch, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { PolicyFormState } from './usePolicyForm';

const { Text } = Typography;

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontSize: 13,
};

/**
 * Name / description / active / default-deny header for a policy. Presentational
 * only — it reads `state` and reports edits through `setField` rather than
 * holding its own draft.
 */
export const PolicyForm: React.FC<{
  state: PolicyFormState;
  setField: <K extends keyof PolicyFormState>(key: K, value: PolicyFormState[K]) => void;
}> = ({ state, setField }) => {
  const t = useTranslations('data_source_detail');

  // Disabling a policy compiles to WHERE 1 = 0 rather than "no filtering",
  // so the confirm spells out what actually happens.
  const handleActiveChange = (next: boolean) => {
    if (next) {
      setField('enabled', true);
      return;
    }
    Modal.confirm({
      title: t('policy_active'),
      content: t('policy_active_off_confirm'),
      onOk: () => setField('enabled', false),
      onCancel: () => setField('enabled', true),
    });
  };

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={12} xl={9}>
        <Text style={fieldLabelStyle}>{t('data_source_rls_policy_name')}</Text>
        <Input
          aria-label={t('data_source_rls_policy_name')}
          value={state.name}
          onChange={(event) => setField('name', event.target.value)}
        />
      </Col>
      <Col xs={24} md={12} xl={9}>
        <Text style={fieldLabelStyle}>{t('data_source_rls_policy_description')}</Text>
        <Input
          value={state.description}
          onChange={(event) => setField('description', event.target.value)}
        />
      </Col>
      <Col xs={12} md={6} xl={3}>
        <Text style={fieldLabelStyle}>{t('policy_active')}</Text>
        <div>
          <Switch checked={state.enabled} onChange={handleActiveChange} />
        </div>
      </Col>
      <Col xs={12} md={6} xl={3}>
        <Text style={fieldLabelStyle}>
          {t('data_source_rls_default_deny')}{' '}
          <Tooltip title={t('default_deny_help')}>
            <QuestionCircleOutlined />
          </Tooltip>
        </Text>
        <div>
          <Switch
            checked={state.defaultDeny}
            onChange={(next) => setField('defaultDeny', next)}
          />
        </div>
      </Col>
    </Row>
  );
};

export default PolicyForm;
