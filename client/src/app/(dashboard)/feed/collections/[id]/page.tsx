'use client';

import React, { useEffect, useState } from 'react';
import { Button, Card, Empty, List, Spin, Typography, message } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { socialFeedService } from '@/services/socialFeedService';
import { DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { formatApiValidationError } from '@/utils/validationErrorMessage';

const { Title, Text } = Typography;

type CollectionDetail = {
  id: string;
  name: string;
  description?: string | null;
  itemCount?: number;
  items?: Array<{
    id: string;
    postId: string;
    note?: string | null;
    post?: { id?: string; title?: string; summary?: string };
  }>;
};

export default function FeedCollectionPage() {
  const t = useTranslations('feed');
  const params = useParams();
  const router = useRouter();
  const collectionId = String(params?.id || '');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);

  const load = async () => {
    if (!collectionId) return;
    setLoading(true);
    try {
      const data = (await socialFeedService.getCollection(collectionId)) as CollectionDetail;
      setDetail(data);
    } catch (err) {
      message.error(formatApiValidationError(err));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId]);

  const removeItem = async (itemId: string) => {
    try {
      await socialFeedService.removeCollectionItem(collectionId, itemId);
      message.success(t('collection_item_removed'));
      await load();
    } catch (err) {
      message.error(formatApiValidationError(err));
    }
  };

  return (
    <DashboardPageShell>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '16px 20px 40px' }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => router.push('/feed')}
          style={{ marginBottom: 12 }}
        >
          {t('back_to_feed')}
        </Button>

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : !detail ? (
          <Empty description={t('collection_not_found')} />
        ) : (
          <Card>
            <Title level={3} style={{ marginTop: 0 }}>
              {detail.name}
            </Title>
            {detail.description ? <Text type="secondary">{detail.description}</Text> : null}
            <List
              style={{ marginTop: 16 }}
              locale={{ emptyText: <Empty description={t('collection_empty')} /> }}
              dataSource={detail.items || []}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key="open"
                      type="link"
                      onClick={() => router.push(`/feed/${item.postId}`)}
                    >
                      {t('open')}
                    </Button>,
                    <Button
                      key="remove"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => void removeItem(item.id)}
                    />,
                  ]}
                >
                  <List.Item.Meta
                    title={item.post?.title || item.postId}
                    description={item.note || item.post?.summary || null}
                  />
                </List.Item>
              )}
            />
          </Card>
        )}
      </div>
    </DashboardPageShell>
  );
}
