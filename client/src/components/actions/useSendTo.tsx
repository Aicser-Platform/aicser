'use client';

import React, { useState } from 'react';
import { Button, Form, Input, List, Modal, Select, Space, Typography, message } from 'antd';
import type { MenuProps } from 'antd';
import { DeleteOutlined, MailOutlined, SendOutlined, SettingOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import {
  createDestination, deleteDestination, listDestinations, sendResult,
  type DestinationKind, type ResultPayload,
} from '@/api/actions';

const { Text } = Typography;
const MAX_ROWS = 5000;

/**
 * "Send to…" for any result: a submenu of the organization's destinations (email, webhook, Slack,
 * Teams) and a manager to set them up. Returns menu items to merge into an existing menu, and the
 * manager dialog to render once.
 */
export function useSendTo() {
  const t = useTranslations('actions');
  const qc = useQueryClient();
  const [managing, setManaging] = useState(false);
  const [form] = Form.useForm();
  const kind = Form.useWatch('kind', form) as DestinationKind | undefined;
  const { data: destinations } = useQuery({
    queryKey: ['actions', 'destinations'],
    queryFn: listDestinations,
    enabled: isEnterpriseEdition,
    staleTime: 60_000,
  });

  const send = async (id: string, getResult: () => ResultPayload | null) => {
    const result = getResult();
    if (!result) return;
    if (result.rows.length > MAX_ROWS) {
      message.warning(t('too_many_rows', { max: MAX_ROWS.toLocaleString() }));
      return;
    }
    const hide = message.loading(t('sending'), 0);
    try {
      const res = await sendResult(id, { ...result, link: result.link ?? window.location.href });
      message.success(t('sent', { destination: res.destination }));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      hide();
    }
  };

  const items = (getResult: () => ResultPayload | null, disabled = false): MenuProps['items'] =>
    isEnterpriseEdition
      ? [
          {
            key: 'send-to',
            icon: <SendOutlined />,
            label: t('send_to'),
            disabled,
            children: [
              ...(destinations ?? []).map((d) => ({
                key: `send-${d.id}`,
                label: `${d.name} · ${t(`kind_${d.kind}`)}`,
                onClick: () => void send(d.id, getResult),
              })),
              ...((destinations ?? []).length ? [{ type: 'divider' as const }] : []),
              { key: 'send-manage', icon: <SettingOutlined />, label: t('manage'), onClick: () => setManaging(true) },
            ],
          },
        ]
      : [];

  const add = async () => {
    const v = await form.validateFields();
    try {
      await createDestination({
        name: v.name,
        kind: v.kind,
        recipients: v.kind === 'email' ? v.recipients : undefined,
        url: v.kind !== 'email' ? v.url : undefined,
      });
      form.resetFields();
      void qc.invalidateQueries({ queryKey: ['actions', 'destinations'] });
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  const manager = (
    <Modal open={managing} title={t('manage_title')} onCancel={() => setManaging(false)} footer={null} width={560} destroyOnHidden>
      <List
        size="small"
        dataSource={destinations ?? []}
        locale={{ emptyText: t('none') }}
        renderItem={(d) => (
          <List.Item
            actions={[
              <Button
                key="del"
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                aria-label={t('remove')}
                onClick={async () => {
                  await deleteDestination(d.id);
                  void qc.invalidateQueries({ queryKey: ['actions', 'destinations'] });
                }}
              />,
            ]}
          >
            <Space direction="vertical" size={0}>
              <Text>{d.name}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t(`kind_${d.kind}`)} · {d.kind === 'email' ? d.recipients.join(', ') : d.address}
              </Text>
            </Space>
          </List.Item>
        )}
      />
      <Form form={form} layout="vertical" initialValues={{ kind: 'email' }} style={{ marginTop: 16 }}>
        <Space align="start" wrap>
          <Form.Item name="name" label={t('field_name')} rules={[{ required: true, max: 120 }]}>
            <Input placeholder={t('field_name_placeholder')} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="kind" label={t('field_kind')}>
            <Select
              style={{ width: 140 }}
              options={(['email', 'slack', 'teams', 'webhook'] as DestinationKind[]).map((k) => ({ value: k, label: t(`kind_${k}`) }))}
            />
          </Form.Item>
        </Space>
        {kind === 'email' ? (
          <Form.Item name="recipients" label={t('field_recipients')} rules={[{ required: true }]}>
            <Select mode="tags" open={false} tokenSeparators={[',', ' ']} suffixIcon={<MailOutlined />} placeholder="finance@acme.com" />
          </Form.Item>
        ) : (
          <Form.Item name="url" label={t(`field_url_${kind ?? 'webhook'}`)} rules={[{ required: true, type: 'url' }]} extra={t('url_hint')}>
            <Input placeholder="https://" />
          </Form.Item>
        )}
        <Button type="primary" onClick={() => void add()}>{t('add')}</Button>
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>{t('admin_only')}</Text>
      </Form>
    </Modal>
  );

  return { items, manager };
}
