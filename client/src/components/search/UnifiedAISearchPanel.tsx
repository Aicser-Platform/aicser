'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  List,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { MessageOutlined, SearchOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { getChatHref } from '@/utils/appPaths';
import { useTranslations } from 'next-intl';
import { KnowledgeSearchPanel } from '@/components/knowledge/KnowledgeSearchPanel';
import { useKnowledgeLibraries } from '@/hooks/useKnowledgeLibraries';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { fetchApi } from '@/utils/api';

const { Text, Paragraph, Title } = Typography;

type SavedQueryRow = {
  id: string;
  name: string;
  sql?: string;
  description?: string;
};

type SchemaMatch = {
  table: string;
  column?: string;
  type?: string;
  score: number;
};

function flattenSchema(schema: Record<string, unknown>): SchemaMatch[] {
  const rows: SchemaMatch[] = [];
  const tables = (schema?.tables as Record<string, unknown>) ?? schema;

  for (const [tableName, tableDef] of Object.entries(tables)) {
    if (!tableDef || typeof tableDef !== 'object') continue;
    const def = tableDef as Record<string, unknown>;
    rows.push({ table: tableName, score: 0 });

    const columns = def.columns ?? def.fields;
    if (columns && typeof columns === 'object') {
      for (const [colName, colDef] of Object.entries(columns as Record<string, unknown>)) {
        const col = colDef as Record<string, unknown>;
        rows.push({
          table: tableName,
          column: colName,
          type: String(col?.type ?? col?.data_type ?? ''),
          score: 0,
        });
      }
    }
  }
  return rows;
}

function scoreSchemaMatch(query: string, row: SchemaMatch): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const hay = [row.table, row.column, row.type].filter(Boolean).join(' ').toLowerCase();
  if (hay.includes(q)) return 1;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits / tokens.length;
}

export interface UnifiedAISearchPanelProps {
  defaultTab?: 'knowledge' | 'schema' | 'queries';
  defaultLibraryId?: string | null;
}

export const UnifiedAISearchPanel: React.FC<UnifiedAISearchPanelProps> = ({
  defaultTab = 'knowledge',
  defaultLibraryId,
}) => {
  const t = useTranslations('ai_search');
  const orgId = useOrganizationStore((s) => s.currentOrganization?.id);
  const projectId = useProjectStore((s) => s.currentProject?.id);
  const { libraries, isLoading: librariesLoading } = useKnowledgeLibraries(orgId, projectId);

  const [activeTab, setActiveTab] = useState(defaultTab);
  const [globalQuery, setGlobalQuery] = useState('');
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [selectedDataSourceId, setSelectedDataSourceId] = useState<string | null>(null);

  const [savedQueries, setSavedQueries] = useState<SavedQueryRow[]>([]);
  const [queriesLoading, setQueriesLoading] = useState(false);

  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaMatches, setSchemaMatches] = useState<SchemaMatch[]>([]);

  const libraryOptions = useMemo(
    () =>
      libraries.map((lib) => ({
        value: lib.id,
        label: lib.name,
        dataSourceId: lib.data_source_id,
      })),
    [libraries]
  );

  const dataSourceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const lib of libraries) {
      if (lib.data_source_id && !seen.has(lib.data_source_id)) {
        seen.set(lib.data_source_id, lib.name);
      }
    }
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [libraries]);

  useEffect(() => {
    if (defaultLibraryId) {
      setSelectedLibraryId(defaultLibraryId);
      const lib = libraries.find((l) => l.id === defaultLibraryId);
      if (lib?.data_source_id) setSelectedDataSourceId(lib.data_source_id);
      return;
    }
    if (!selectedLibraryId && libraryOptions.length) {
      setSelectedLibraryId(libraryOptions[0].value);
      setSelectedDataSourceId(libraryOptions[0].dataSourceId ?? null);
    }
  }, [defaultLibraryId, libraryOptions, libraries, selectedLibraryId]);

  useEffect(() => {
    if (!selectedDataSourceId && dataSourceOptions.length) {
      setSelectedDataSourceId(dataSourceOptions[0].value);
    }
  }, [dataSourceOptions, selectedDataSourceId]);

  useEffect(() => {
    setQueriesLoading(true);
    fetchApi('queries/saved-queries')
      .then((res: { items?: SavedQueryRow[]; saved_queries?: SavedQueryRow[] }) => {
        const list = res?.items || res?.saved_queries || (Array.isArray(res) ? res : []);
        setSavedQueries(list as SavedQueryRow[]);
      })
      .catch(() => setSavedQueries([]))
      .finally(() => setQueriesLoading(false));
  }, [orgId, projectId]);

  const knowledgeDataSourceId = useMemo(() => {
    if (selectedLibraryId) {
      const lib = libraries.find((l) => l.id === selectedLibraryId);
      return lib?.data_source_id ?? selectedDataSourceId;
    }
    return selectedDataSourceId;
  }, [libraries, selectedDataSourceId, selectedLibraryId]);

  const filteredQueries = useMemo(() => {
    const q = globalQuery.trim().toLowerCase();
    if (!q) return savedQueries;
    return savedQueries.filter((row) => {
      const hay = [row.name, row.description, row.sql].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [globalQuery, savedQueries]);

  const runSchemaSearch = useCallback(async () => {
    const q = globalQuery.trim();
    if (!q || !selectedDataSourceId) {
      setSchemaMatches([]);
      return;
    }
    setSchemaLoading(true);
    try {
      const res = await fetchApi(`data/sources/${selectedDataSourceId}/schema`);
      const schema = (res?.schema ?? res) as Record<string, unknown>;
      const flat = flattenSchema(schema);
      const ranked = flat
        .map((row) => ({ ...row, score: scoreSchemaMatch(q, row) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40);
      setSchemaMatches(ranked);
    } catch {
      setSchemaMatches([]);
    } finally {
      setSchemaLoading(false);
    }
  }, [globalQuery, selectedDataSourceId]);

  useEffect(() => {
    if (activeTab === 'schema' && globalQuery.trim()) {
      void runSchemaSearch();
    }
  }, [activeTab, globalQuery, runSchemaSearch]);

  const knowledgeSearchOptions = useMemo(
    () =>
      libraryOptions.map((o) => ({
        value: o.dataSourceId ?? o.value,
        label: o.label,
      })),
    [libraryOptions]
  );

  return (
    <div>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>
            {t('title')}
          </Title>
          <Text type="secondary">{t('subtitle')}</Text>
        </div>

        <Alert type="info" showIcon message={t('hint')} />

        <Card size="small">
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder={t('search_placeholder')}
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              onPressEnter={() => {
                if (activeTab === 'schema') void runSchemaSearch();
              }}
              allowClear
            />
            {activeTab === 'schema' ? (
              <Button
                type="primary"
                icon={<SearchOutlined />}
                loading={schemaLoading}
                disabled={!globalQuery.trim() || !selectedDataSourceId}
                onClick={() => void runSchemaSearch()}
              >
                {t('search')}
              </Button>
            ) : null}
          </Space.Compact>
        </Card>

        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as typeof activeTab)}
          items={[
            {
              key: 'knowledge',
              label: t('tab_knowledge'),
              children: librariesLoading ? (
                <Spin />
              ) : (
                <KnowledgeSearchPanel
                  dataSourceId={knowledgeDataSourceId ?? null}
                  dataSourceOptions={knowledgeSearchOptions}
                  showDataSourceSelector={libraryOptions.length > 1}
                  onDataSourceChange={(id) => {
                    setSelectedDataSourceId(id);
                    const lib = libraries.find((l) => l.data_source_id === id);
                    if (lib) setSelectedLibraryId(lib.id);
                  }}
                  showRetrievalHint
                  defaultTopK={8}
                />
              ),
            },
            {
              key: 'schema',
              label: t('tab_schema'),
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <Select
                    style={{ width: '100%', maxWidth: 420 }}
                    placeholder={t('select_data_source')}
                    value={selectedDataSourceId ?? undefined}
                    onChange={setSelectedDataSourceId}
                    options={dataSourceOptions}
                    loading={librariesLoading}
                  />
                  {schemaLoading ? (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                      <Spin />
                    </div>
                  ) : schemaMatches.length ? (
                    <List
                      dataSource={schemaMatches}
                      renderItem={(item) => (
                        <List.Item key={`${item.table}.${item.column ?? ''}`}>
                          <List.Item.Meta
                            title={
                              <Space>
                                <Text strong>{item.table}</Text>
                                {item.column ? (
                                  <>
                                    <Text type="secondary">.</Text>
                                    <Text code>{item.column}</Text>
                                  </>
                                ) : null}
                                {item.type ? <Tag>{item.type}</Tag> : null}
                              </Space>
                            }
                            description={
                              globalQuery.trim() ? (
                                <Link href={getChatHref({ prompt: `Describe the ${item.table}${item.column ? `.${item.column}` : ''} column and how it relates to our business` })}>
                                  <Button size="small" icon={<MessageOutlined />}>
                                    {t('ask_in_chat')}
                                  </Button>
                                </Link>
                              ) : null
                            }
                          />
                        </List.Item>
                      )}
                    />
                  ) : globalQuery.trim() ? (
                    <Empty description={t('no_schema_results')} />
                  ) : (
                    <Empty description={t('schema_prompt')} />
                  )}
                </Space>
              ),
            },
            {
              key: 'queries',
              label: t('tab_queries'),
              children: queriesLoading ? (
                <Spin />
              ) : filteredQueries.length ? (
                <List
                  dataSource={filteredQueries}
                  renderItem={(item) => (
                    <List.Item
                      key={item.id}
                      actions={[
                        <Link key="editor" href={`/query-editor?saved_query_id=${encodeURIComponent(item.id)}`}>
                          {t('open_in_editor')}
                        </Link>,
                        <Link
                          key="chat"
                          href={getChatHref({ prompt: `Run and explain saved query "${item.name}":\n${item.sql ?? ''}` })}
                        >
                          {t('ask_in_chat')}
                        </Link>,
                      ]}
                    >
                      <List.Item.Meta
                        title={item.name}
                        description={
                          <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0, fontFamily: 'monospace' }}>
                            {item.sql || item.description}
                          </Paragraph>
                        }
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description={t('no_query_results')} />
              ),
            },
          ]}
        />
      </Space>
    </div>
  );
};

export default UnifiedAISearchPanel;
