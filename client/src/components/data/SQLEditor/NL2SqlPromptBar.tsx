'use client';

import React, { useMemo, useState } from 'react';
import { Input, Select, Button, Space, message } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useAiModels, useGenerateSql } from '@/hooks/useAi';
import { ApiError } from '@/utils/api';

type Props = {
  dataSourceId?: string;
  onInsert: (sql: string) => void;
};

export default function NL2SqlPromptBar({ dataSourceId, onInsert }: Props) {
  const [question, setQuestion] = useState('');
  const [model, setModel] = useState<string | undefined>();
  const { data: models = [], isLoading: modelsLoading } = useAiModels();
  const { mutateAsync, isPending } = useGenerateSql();

  const options = useMemo(
    () =>
      models.map((m) => ({
        label: m.available ? m.name : `${m.name} (no key)`,
        value: m.id,
        disabled: !m.available,
      })),
    [models]
  );

  const firstAvailable = useMemo(() => models.find((m) => m.available)?.id, [models]);
  const effectiveModel = model ?? firstAvailable;

  const handleGenerate = async () => {
    if (!question.trim()) {
      message.warning('Enter a question first.');
      return;
    }
    if (!dataSourceId) {
      message.warning('Select a data source first.');
      return;
    }
    try {
      const res = await mutateAsync({ question: question.trim(), data_source_id: dataSourceId, model: effectiveModel });
      onInsert(res.sql);
      if (res.warning) message.warning(res.warning);
      else message.success('SQL generated.');
    } catch (err) {
      if (err instanceof ApiError && (err.detail as { code?: string } | undefined)?.code === 'no_provider_key') {
        message.error('No AI key configured. Add one in Settings → API Keys.');
      } else {
        message.error(err instanceof Error ? err.message : 'Generation failed.');
      }
    }
  };

  return (
    <Space.Compact block style={{ padding: '8px 12px', gap: 8, display: 'flex' }}>
      <Input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onPressEnter={handleGenerate}
        placeholder="Ask a question about your data…"
        allowClear
      />
      <Select
        value={effectiveModel}
        onChange={setModel}
        options={options}
        loading={modelsLoading}
        placeholder="Model"
        style={{ minWidth: 180 }}
      />
      <Button type="primary" icon={<ThunderboltOutlined />} loading={isPending} onClick={handleGenerate}>
        Generate
      </Button>
    </Space.Compact>
  );
}
