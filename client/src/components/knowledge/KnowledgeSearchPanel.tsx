'use client';

import React, { useState } from 'react';
import {
  Input,
  Button,
  Select,
  List,
  Typography,
  Tag,
  Empty,
  Spin,
  Space,
  Alert,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { PermissionGuard } from '@/components/PermissionGuard';
import { Permission } from '@/hooks/usePermissions';
import { useSearchKnowledge } from '@/hooks/useKnowledge';
import type { RetrievedChunk } from '@/api/knowledge';

const { Text, Paragraph } = Typography;

export interface KnowledgeSearchPanelProps {
  dataSourceId: string | null;
  dataSourceOptions?: { value: string; label: string }[];
  onDataSourceChange?: (id: string) => void;
  showDataSourceSelector?: boolean;
  defaultTopK?: number;
  showRetrievalHint?: boolean;
}

export const KnowledgeSearchPanel: React.FC<KnowledgeSearchPanelProps> = ({
  dataSourceId,
  dataSourceOptions = [],
  onDataSourceChange,
  showDataSourceSelector = false,
  defaultTopK = 5,
  showRetrievalHint = false,
}) => {
  const t = useTranslations('knowledge');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RetrievedChunk[]>([]);
  const { mutateAsync: search, isPending } = useSearchKnowledge();

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed || !dataSourceId) return;

    try {
      const res = await search({
        query: trimmed,
        data_source_id: dataSourceId,
        top_k: defaultTopK,
      });
      setResults(res.results ?? []);
    } catch {
      setResults([]);
    }
  };

  const canSearch = !!dataSourceId && query.trim().length > 0;

  return (
    <div>
      {showRetrievalHint ? (
        <Alert type="info" showIcon message={t('tab_search_hint')} style={{ marginBottom: 16 }} />
      ) : null}
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {showDataSourceSelector && dataSourceOptions.length > 0 && (
          <Select
            style={{ width: '100%' }}
            placeholder={t('select_knowledge_base')}
            value={dataSourceId ?? undefined}
            onChange={onDataSourceChange}
            options={dataSourceOptions}
          />
        )}

        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder={t('search_placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onPressEnter={() => void handleSearch()}
            disabled={!dataSourceId}
          />
          <PermissionGuard permission={Permission.KNOWLEDGE_SEARCH}>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={isPending}
              disabled={!canSearch}
              onClick={() => void handleSearch()}
            >
              {t('search')}
            </Button>
          </PermissionGuard>
        </Space.Compact>
      </Space>

      <div style={{ marginTop: 16 }}>
        {isPending ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">{t('searching')}</Text>
            </div>
          </div>
        ) : results.length > 0 ? (
          <List
            dataSource={results}
            renderItem={(item) => (
              <List.Item key={item.chunk_id}>
                <List.Item.Meta
                  title={
                    <Space>
                      <Text strong>{item.document_filename ?? t('unknown_document')}</Text>
                      <Tag color="blue">{Math.round(item.score * 100)}%</Tag>
                    </Space>
                  }
                  description={
                    <Paragraph
                      ellipsis={{ rows: 4, expandable: true, symbol: t('show_more') }}
                      style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
                    >
                      {item.content}
                    </Paragraph>
                  }
                />
              </List.Item>
            )}
          />
        ) : query.trim() && !isPending ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('no_results')} />
        ) : null}
      </div>
    </div>
  );
};

export default KnowledgeSearchPanel;
