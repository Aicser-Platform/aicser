'use client';

import React from 'react';
import {
  BookOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  FileOutlined,
} from '@ant-design/icons';
import { Empty, Spin, Tag, Tooltip, Typography } from 'antd';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { KnowledgeDocument } from '@/api/knowledge';

const { Text } = Typography;

export interface KnowledgeDocumentSummaryProps {
  documents: KnowledgeDocument[];
  loading?: boolean;
  /** Link to full document management (e.g. /knowledge?data_source_id=…) */
  manageHref?: string;
  emptyDescription?: string;
}

export const KnowledgeDocumentSummary: React.FC<KnowledgeDocumentSummaryProps> = ({
  documents,
  loading = false,
  manageHref,
  emptyDescription,
}) => {
  const t = useTranslations('knowledge');

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 16 }}>
        <Spin size="small" />
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.65 }}>{t('loading_documents')}</div>
      </div>
    );
  }

  if (!documents.length) {
    return (
      <div style={{ padding: '12px 0' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={emptyDescription ?? t('no_documents')}
        />
        {manageHref ? (
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <Link href={manageHref}>{t('manage_documents')}</Link>
          </div>
        ) : null}
      </div>
    );
  }

  const readyDocs = documents.filter((d) => d.status === 'ready');
  const totalChunks = readyDocs.reduce((sum, d) => sum + (d.chunk_count || 0), 0);

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '0 2px' }}>
        <BookOutlined style={{ fontSize: 13, opacity: 0.6 }} />
        <Text strong style={{ fontSize: 12 }}>{t('summary_title')}</Text>
        <Tag color="cyan" style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>
          {t('kb_docs_chunks', { docCount: readyDocs.length, chunkCount: totalChunks })}
        </Tag>
        {manageHref ? (
          <Link href={manageHref} style={{ marginLeft: 'auto', fontSize: 11 }}>
            {t('manage_documents')}
          </Link>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {documents.map((doc) => (
          <div
            key={doc.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 8px',
              borderRadius: 6,
              background: 'var(--ant-color-bg-container, rgba(0,0,0,0.02))',
              fontSize: 12,
            }}
          >
            <FileOutlined style={{ fontSize: 12, opacity: 0.5 }} />
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
              title={doc.filename}
            >
              {doc.filename}
            </span>
            {doc.status === 'ready' ? (
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 11 }} />
            ) : doc.status === 'failed' ? (
              <Tooltip title={doc.error_message || t('ingestion_failed')}>
                <CloseOutlined style={{ color: '#ff4d4f', fontSize: 11 }} />
              </Tooltip>
            ) : (
              <Spin size="small" />
            )}
            {doc.chunk_count > 0 ? (
              <Text type="secondary" style={{ fontSize: 10 }}>
                {t('kb_chunks_only', { chunkCount: doc.chunk_count })}
              </Text>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};
