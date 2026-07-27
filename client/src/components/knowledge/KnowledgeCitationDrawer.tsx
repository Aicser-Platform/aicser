'use client';

import React, { useEffect, useMemo } from 'react';
import { Drawer, Typography, Tag, Spin, Empty } from 'antd';
import { BookOutlined, FileTextOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useKnowledgeDocument } from '@/hooks/useKnowledge';

const { Text, Paragraph } = Typography;

export interface KnowledgeCitationDrawerProps {
  open: boolean;
  onClose: () => void;
  documentId?: string | null;
  chunkId?: string | null;
  source?: string;
  excerpt?: string;
  pages?: string;
  sections?: string[];
  relevanceScore?: number;
}

export function KnowledgeCitationDrawer({
  open,
  onClose,
  documentId,
  chunkId,
  source,
  excerpt,
  pages,
  sections,
  relevanceScore,
}: KnowledgeCitationDrawerProps) {
  const t = useTranslations('knowledge');
  const { document, isLoading } = useKnowledgeDocument(open && documentId ? documentId : null);

  const title = document?.filename || source || t('unknown_document');

  const sectionLabel = useMemo(() => {
    if (!sections?.length) return null;
    return sections.slice(0, 2).join(' · ');
  }, [sections]);

  useEffect(() => {
    if (!open) return;
  }, [open, documentId, chunkId]);

  return (
    <Drawer
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOutlined />
          {t('citation_drawer_title')}
        </span>
      }
      open={open}
      onClose={onClose}
      width={440}
      destroyOnHidden
    >
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : !documentId ? (
        <Empty description={t('citation_no_document')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <FileTextOutlined style={{ opacity: 0.6 }} />
              <Text strong style={{ fontSize: 15 }}>
                {title}
              </Text>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {document?.status === 'ready' ? (
                <Tag color="success">{t('col_status')}: ready</Tag>
              ) : document?.status ? (
                <Tag>{document.status}</Tag>
              ) : null}
              {pages ? <Tag>{t('citation_pages', { pages })}</Tag> : null}
              {sectionLabel ? <Tag color="blue">{sectionLabel}</Tag> : null}
              {relevanceScore != null && relevanceScore >= 0.3 ? (
                <Tag color="cyan">{Math.round(relevanceScore * 100)}% match</Tag>
              ) : null}
              {chunkId ? (
                <Tag style={{ fontFamily: 'monospace', fontSize: 10 }}>
                  chunk {chunkId.slice(0, 8)}…
                </Tag>
              ) : null}
            </div>
          </div>

          {excerpt ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'var(--ant-color-fill-quaternary)',
                borderLeft: '3px solid var(--ant-color-primary)',
              }}
            >
              <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                {t('citation_passage')}
              </Text>
              <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                &ldquo;{excerpt}&rdquo;
              </Paragraph>
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('citation_no_excerpt')} />
          )}

          {document && document.chunk_count > 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('kb_chunks_only', { chunkCount: document.chunk_count })}
            </Text>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

export default KnowledgeCitationDrawer;
