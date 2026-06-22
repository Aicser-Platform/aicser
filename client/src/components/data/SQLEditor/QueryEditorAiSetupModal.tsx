'use client';

import React from 'react';
import { Modal, Typography, Button, Space, List } from 'antd';
import { KeyOutlined, CloudOutlined, SettingOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { SETTINGS_API_KEYS_PROVIDERS_PATH } from '@/config/settingsLinks';

const { Text, Paragraph } = Typography;

const AI_SETUP_DISMISS_KEY = 'qe_ai_setup_dismissed_v1';

export function isQueryEditorAiSetupDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(AI_SETUP_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissQueryEditorAiSetup(): void {
  try {
    window.localStorage.setItem(AI_SETUP_DISMISS_KEY, '1');
  } catch {
    /* ignore */
  }
}

interface QueryEditorAiSetupModalProps {
  open: boolean;
  onClose: () => void;
}

export const QueryEditorAiSetupModal: React.FC<QueryEditorAiSetupModalProps> = ({ open, onClose }) => {
  const t = useTranslations('monaco_sql_editor');
  const router = useRouter();

  const goToSettings = () => {
    onClose();
    router.push(SETTINGS_API_KEYS_PROVIDERS_PATH);
  };

  return (
    <Modal
      open={open}
      title={t('ai_setup_title')}
      onCancel={onClose}
      footer={
        <Space wrap>
          <Button onClick={onClose}>{t('ai_setup_later')}</Button>
          <Button
            type="link"
            onClick={() => {
              dismissQueryEditorAiSetup();
              onClose();
            }}
          >
            {t('ai_setup_dont_show')}
          </Button>
          <Button type="primary" icon={<SettingOutlined />} onClick={goToSettings}>
            {t('ai_setup_open_settings')}
          </Button>
        </Space>
      }
      width={520}
      centered
    >
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t('ai_setup_desc')}
      </Paragraph>
      <List
        size="small"
        dataSource={[
          {
            icon: <CloudOutlined style={{ color: 'var(--ant-color-primary)' }} />,
            title: t('ai_setup_operator_title'),
            desc: t('ai_setup_operator_hint'),
          },
          {
            icon: <KeyOutlined style={{ color: 'var(--ant-color-primary)' }} />,
            title: t('ai_setup_byok_title'),
            desc: t('ai_setup_byok_hint'),
          },
        ]}
        renderItem={(item) => (
          <List.Item style={{ border: 'none', padding: '8px 0' }}>
            <List.Item.Meta
              avatar={item.icon}
              title={<Text strong>{item.title}</Text>}
              description={<Text type="secondary">{item.desc}</Text>}
            />
          </List.Item>
        )}
      />
    </Modal>
  );
};
